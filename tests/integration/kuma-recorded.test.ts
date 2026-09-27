/**
 * The real Kuma snapshot the collector recorded on watch-1 (tests/fixtures/data/kuma-recorded.json:
 * live monitor names such as "Primary - Postgres", no outage) replayed through the real ingest routes into
 * D1Store and KvModelCache, then a synthesized down/up pair for one monitor to prove a derived incident
 * opens and resolves on live-shaped data.
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { parseSiteConfig } from "@/shared/config";
import type { KumaSnapshot } from "@/shared/schemas";
import { resetSiteSourceSync } from "@/worker/engine/sites";
import demo from "../../sites/demo.json";
import recorded from "../fixtures/data/kuma-recorded.json";
import { json, pipeline } from "../support/worker-pipeline";

type Snapshot = z.input<typeof KumaSnapshot>;
type Beat = Snapshot["heartbeatsSince"][number];
const at = (base: string, s: number) => new Date(Date.parse(base) + s * 1000);
const iso = (d: Date) => d.toISOString();

const GENERATED = recorded.generatedAt;
/** Beats the adapter stores: heartbeatsSince and importantHeartbeats, de-duplicated on (monitor, ts). */
const RECORDED_BEATS = new Set(
  [...recorded.heartbeatsSince, ...recorded.importantHeartbeats].map(
    (b) => `${b.monitorId}|${Date.parse(b.ts)}`,
  ),
).size;
const t = pipeline(at(GENERATED, 20));

/** A later snapshot from the same collector: same monitors, only the given beats since the last one. */
function next(offsetS: number, beats: Beat[]): Snapshot {
  return {
    ...(structuredClone(recorded) as Snapshot),
    generatedAt: iso(at(GENERATED, offsetS)),
    heartbeatsSince: beats,
    importantHeartbeats: beats,
  };
}

describe("recorded Kuma snapshot through ingest and D1", () => {
  beforeAll(() => resetSiteSourceSync());

  it("uses the service ids sites/demo.json sections reference", () => {
    const config = parseSiteConfig(demo);
    const inSections = config.sections
      .flatMap((s) => s.services)
      .filter((id) => id.startsWith("kuma:"))
      .sort();
    expect(recorded.monitors.map((m) => `kuma:${m.id}`).sort()).toEqual(inSections);
  });

  it("accepts the recording (8 services, every beat), then opens and resolves one incident", async () => {
    const first = await t.send(await t.signed("kuma", "collector-1", recorded));
    expect(first.status).toBe(202);
    expect(await json(first)).toMatchObject({
      latest: true,
      counts: { services: 8, heartbeats: RECORDED_BEATS },
      incidents: { opened: [], resolved: [] },
    });

    let model = await json(await t.get("/api/sites/demo/model"));
    expect(model.services).toHaveLength(8);
    expect(model.services.find((s: { id: string }) => s.id === "kuma:3").name).toBe("Primary - Postgres");
    expect(model.services.every((s: { status: string }) => s.status === "up")).toBe(true);
    expect(model.openIncidents).toEqual([]);

    // Replica - Postgres (monitor 5) goes down one minute later...
    const downTs = iso(at(GENERATED, 45));
    t.setNow(at(GENERATED, 80));
    const down = await t.send(
      await t.signed(
        "kuma",
        "collector-1",
        next(60, [{ monitorId: 5, ts: downTs, status: 0, pingMs: null, msg: "timeout", important: true }]),
      ),
    );
    expect(down.status).toBe(202);
    const opened = await json(down);
    expect(opened.incidents.resolved).toEqual([]);
    expect(opened.incidents.opened).toHaveLength(1);
    const openedId: string = opened.incidents.opened[0];
    expect(openedId.startsWith("kuma:5:")).toBe(true);

    model = await json(await t.get("/api/sites/demo/model"));
    expect(model.services.find((s: { id: string }) => s.id === "kuma:5").status).toBe("down");
    expect(model.openIncidents.map((i: { id: string; title: string }) => [i.id, i.title])).toEqual([
      [openedId, "Replica - Postgres down"],
    ]);

    // ...and is back up the minute after.
    const upTs = iso(at(GENERATED, 105));
    t.setNow(at(GENERATED, 140));
    const up = await t.send(
      await t.signed(
        "kuma",
        "collector-1",
        next(120, [{ monitorId: 5, ts: upTs, status: 1, pingMs: 210, msg: null, important: true }]),
      ),
    );
    expect(up.status).toBe(202);
    expect((await json(up)).incidents).toEqual({ opened: [], resolved: [openedId] });

    model = await json(await t.get("/api/sites/demo/model"));
    expect(model.openIncidents).toEqual([]);
    const done = model.recentIncidents.find((i: { id: string }) => i.id === openedId);
    expect(done).toMatchObject({ kind: "down", serviceId: "kuma:5", title: "Replica - Postgres down" });
    expect(Date.parse(done.endedAt)).toBe(Date.parse(upTs));
    expect(Date.parse(done.startedAt)).toBe(Date.parse(downTs));
  });
});
