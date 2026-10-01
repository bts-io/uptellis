/**
 * `GET /api/sites/:site/view` over the real write path: signed kuma and facts payloads through the ingest
 * routes into D1 (`D1Store`) and KV, then the view built from the model and the `heartbeat_5m` history.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { SiteView } from "@/shared/view";
import { BUCKET_MS, downsample } from "@/worker/cron";
import { schema } from "@/worker/db";
import { ROLLUP_BUCKET_MS } from "@/worker/db/history";
import { D1Store } from "@/worker/engine/d1-store";
import { resetSiteSourceSync } from "@/worker/engine/sites";
import { loadFixture } from "../fixtures";
import { factsPayloadFrom, kumaSnapshotFrom } from "../support/fixture-payloads";
import { testPlatform } from "../support/platform";
import { json, pipeline } from "../support/worker-pipeline";

const NOW = new Date("2026-09-27T23:58:00Z");
const { signed, send, get } = pipeline(NOW);
const platform = testPlatform();
const db = platform.db;
const DAY = 86_400_000;
const at = (iso: string) => Date.parse(iso);

const getView = async (): Promise<SiteView> => {
  const res = await get("/api/sites/demo/view");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  return json(res);
};
const service = (v: SiteView, id: string) => v.sections.flatMap((s) => s.services).find((s) => s.id === id)!;

describe("GET /api/sites/:site/view", () => {
  beforeAll(async () => {
    resetSiteSourceSync();
    // Two older days of kuma:5 in the rollup: a clean day and the app-2 reboot (42 min down).
    const rows: (typeof schema.heartbeat5m.$inferInsert)[] = [];
    for (let b = 0; b < 288; b++) {
      const bucket = at("2026-09-14T00:00:00Z") + b * ROLLUP_BUCKET_MS;
      rows.push({
        site: "demo",
        serviceId: "kuma:5",
        bucket,
        total: 5,
        up: 5,
        down: 0,
        maint: 0,
        pending: 0,
      });
      const reboot = b >= 38 && b < 46; // 03:10 to 03:50 all down, then 2 of 5 beats: 42 min
      rows.push({
        site: "demo",
        serviceId: "kuma:5",
        bucket: bucket + DAY,
        total: 5,
        up: reboot ? 0 : b === 46 ? 3 : 5,
        down: reboot ? 5 : b === 46 ? 2 : 0,
        maint: 0,
        pending: 0,
      });
    }
    // Outside the 90-day window: never read.
    rows.push({
      site: "demo",
      serviceId: "kuma:5",
      bucket: at("2026-06-29T12:00:00Z"),
      total: 5,
      up: 0,
      down: 5,
      maint: 0,
      pending: 0,
    });
    for (let i = 0; i < rows.length; i += 10)
      await db.insert(schema.heartbeat5m).values(rows.slice(i, i + 10));
  });

  it("uses the cron's rollup window", () => {
    expect(ROLLUP_BUCKET_MS).toBe(BUCKET_MS);
  });

  it("answers 404 for unknown sites", async () => {
    const res = await get("/api/sites/nope/view");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await json(res)).toEqual({ error: "not_found", message: "Unknown site" });
  });

  it("serves an empty view before anything was ingested", async () => {
    const v = await getView();
    expect(v.verdict.state).toBe("empty");
    // Only the demo's two edge probes, from the config: they have not run their first check yet.
    expect(v.sections.flatMap((s) => s.services.map((x) => [x.id, x.state]))).toEqual([
      ["probe:api-health", "pending"],
      ["probe:web-app", "pending"],
    ]);
    expect(v.freshness.perSource.map((s) => s.freshness)).toEqual(["empty", "empty", "empty"]);
  });

  it("builds the view from ingested payloads and 90 days of history", async () => {
    expect(
      (await send(await signed("kuma", "collector-1", kumaSnapshotFrom(loadFixture("default"))))).status,
    ).toBe(202);
    expect(
      (await send(await signed("facts", "facts-1", factsPayloadFrom(loadFixture("default"))))).status,
    ).toBe(202);
    const v = await getView();
    expect(v.now).toBe("2026-09-27T23:58:00Z");
    expect(v.generatedAt).toBe("2026-09-27T23:57:26Z");
    expect(v.verdict).toMatchObject({ state: "operational", down: 0 });
    // The web section also lists the two edge probes, pending until their first check.
    expect(v.sections.map((s) => [s.id, s.services.length, s.exitCode])).toEqual([
      ["web", 4, 1],
      ["database", 2, 0],
      ["access", 2, 0],
      ["workers", 2, 0],
    ]);
    expect(v.factIndex["replication.lagSeconds"]).toMatchObject({ display: "0 s", level: "ok" });
    expect(v.factIndex["backup.lastAt"]).toMatchObject({ display: "26 min ago", level: "ok" });
    expect(v.factIndex["kuma.dbSize"]!.display).toBe("41.2 MB");
    expect(v.topology!.edges.find((e) => e.kind === "replication")).toMatchObject({
      live: true,
      detail: "lag 0 s",
    });

    const standby = service(v, "kuma:5");
    expect(standby.recent).toHaveLength(5);
    expect(standby.beats90d.at(-1)).toMatchObject({
      day: "2026-09-27",
      worst: "up",
      uptime: 1,
      minutesDown: 0,
    });
    expect(standby.beats90d.find((d) => d.day === "2026-09-14")).toMatchObject({ worst: "up", uptime: 1 });
    expect(standby.beats90d.find((d) => d.day === "2026-09-15")).toEqual({
      day: "2026-09-15",
      worst: "down",
      uptime: 0.970833,
      minutesDown: 42,
    });
    expect(standby.beatsText[0]).toBe(".");
    expect(standby.beatsText.slice(-14)).toBe(`+x${".".repeat(11)}+`);
  });

  it("gives the same history before and after the cron folds the raw beats", async () => {
    expect(
      (await send(await signed("kuma", "collector-1", kumaSnapshotFrom(loadFixture("incident"))))).status,
    ).toBe(202);
    const store = new D1Store(platform);
    const before = await store.loadHistory("demo", NOW.toISOString());
    await downsample(db, NOW.getTime());
    const after = await store.loadHistory("demo", NOW.toISOString());
    expect(after).toEqual(before);
    const today = before.find((s) => s.serviceId === "kuma:5")!.days.at(-1)!;
    // The incident snapshot's timeout beats (23:52 on) make today a down day.
    expect(today).toMatchObject({ day: "2026-09-27", worst: "down" });
    expect(today.minutesDown).toBeGreaterThan(0);

    const v = await getView();
    expect(v.verdict).toMatchObject({ state: "outage", down: 1 });
    expect(service(v, "kuma:5")).toMatchObject({
      state: "down",
      openIncidentId: "kuma:5:2026-09-27T23:52:00Z",
    });
    expect(service(v, "kuma:5").beatsText.at(-1)).toBe("x");
    expect(v.incidents.open.map((i) => i.subject)).toEqual(["Replica Postgres"]);
  });
});
