/**
 * The whole Phase 1 write and read path in workerd: the real ingest routes and read routes, mounted as
 * src/worker/index.ts mounts them, over the real `D1Store` (migrated D1) and `KvModelCache` (KV). Only the
 * clock is pinned, to the fixtures' time. Signing uses the shared `signRequest` with the test secrets bound
 * in vitest.config.ts.
 */
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createDb, schema } from "@/worker/db";
import { resetSiteSourceSync } from "@/worker/engine/sites";
import { loadFixture } from "../fixtures";
import { factsPayloadFrom, kumaSnapshotFrom } from "../support/fixture-payloads";
import { json, pipeline, workerEnv } from "../support/worker-pipeline";

const NOW = new Date("2026-09-27T23:58:00Z");
const { signed, send, get } = pipeline(NOW);

describe("ingest -> D1Store + KvModelCache -> read routes", () => {
  beforeAll(() => {
    expect(workerEnv.INGEST_KEY_COLLECTOR_1).toBeTruthy();
    expect(workerEnv.INGEST_KEY_FACTS_1).toBeTruthy();
    resetSiteSourceSync();
  });

  it("accepts kuma, facts and an incident snapshot, then serves the model and fresh sources", async () => {
    const kumaReq = await signed("kuma", "collector-1", kumaSnapshotFrom(loadFixture("default")));
    const replay = kumaReq.clone();
    const kuma = await send(kumaReq);
    expect(kuma.status).toBe(202);
    expect(await json(kuma)).toMatchObject({
      latest: true,
      counts: { services: 8, heartbeats: 40 },
      incidents: { opened: [], resolved: [] },
    });

    const facts = await send(await signed("facts", "facts-1", factsPayloadFrom(loadFixture("default"))));
    expect(facts.status).toBe(202);
    expect((await json(facts)).counts.facts).toBeGreaterThan(0);

    const incident = await send(
      await signed("kuma", "collector-1", kumaSnapshotFrom(loadFixture("incident"))),
    );
    expect(incident.status).toBe(202);
    expect((await json(incident)).incidents).toEqual({
      opened: ["kuma:5:2026-09-27T23:52:00Z"],
      resolved: [],
    });

    // The same signed request again: the nonce is already claimed in D1.
    const again = await send(replay);
    expect(again.status).toBe(409);
    expect(await json(again)).toEqual({ error: "replay" });

    // A late snapshot (older generatedAt): its beats are kept as history, nothing else moves. The old
    // `down` beat of a service with no incident must not open one against D1.
    const old = kumaSnapshotFrom(loadFixture("default"));
    old.generatedAt = "2026-09-27T23:50:00Z";
    old.heartbeatsSince = [
      { monitorId: 3, ts: "2026-09-27T23:40:00Z", status: 0, pingMs: null, msg: "timeout", important: true },
    ];
    old.importantHeartbeats = old.heartbeatsSince;
    const late = await send(await signed("kuma", "collector-1", old));
    expect(late.status).toBe(200);
    expect(await json(late)).toMatchObject({
      latest: false,
      counts: { services: 0, heartbeats: 1, facts: 0 },
      incidents: { opened: [], resolved: [] },
    });

    const model = await get("/api/sites/demo/model");
    expect(model.status).toBe(200);
    const m = await json(model);
    expect(m.services).toHaveLength(8);
    expect(m.openIncidents.map((i: { id: string; kind: string }) => [i.id, i.kind])).toEqual([
      ["kuma:5:2026-09-27T23:52:00Z", "down"],
    ]);
    expect(m.facts.some((f: { source: string }) => f.source === "facts:app-1")).toBe(true);

    const sources = await get("/api/sites/demo/sources");
    expect(sources.status).toBe(200);
    const report = await json(sources);
    const kumaSource = report.sources.find((s: { id: string }) => s.id === "kuma:watch-1");
    expect([kumaSource.lastSeenAt, kumaSource.lastOkAt]).toEqual([
      "2026-09-27T23:57:26Z",
      "2026-09-27T23:57:26Z",
    ]);
    expect(report.sources.map((s: { id: string; freshness: string }) => [s.id, s.freshness])).toEqual([
      ["kuma:watch-1", "fresh"],
      ["facts:app-1", "fresh"],
      ["probe:cf", "empty"],
    ]);

    // Store-side effects the ingest service owns: config intervals synced, every accepted payload kept raw.
    const db = createDb(workerEnv.DB);
    const rows = await db.select().from(schema.sources).where(eq(schema.sources.site, "demo"));
    expect(Object.fromEntries(rows.map((r) => [r.id, r.expectedIntervalS]))).toEqual({
      "kuma:watch-1": 60,
      "facts:app-1": 900,
      "probe:cf": 60,
    });
    const snaps = await db
      .select({ sourceId: schema.snapshots.sourceId })
      .from(schema.snapshots)
      .where(eq(schema.snapshots.site, "demo"))
      .orderBy(asc(schema.snapshots.id));
    expect(snaps.map((s) => s.sourceId)).toEqual([
      "kuma:watch-1",
      "facts:app-1",
      "kuma:watch-1",
      "kuma:watch-1",
    ]);
  });
});
