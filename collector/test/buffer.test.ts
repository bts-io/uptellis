import { describe, expect, it } from "bun:test";
import { BeatBuffer } from "../src/buffer";
import { Collector } from "../src/collector";
import type { IngestConfig } from "../src/config";
import { applyHeartbeat, applyMonitorList, type Beat, createState } from "../src/state";
import { liveBeat, monitorList, NOW } from "./fixtures/kuma-events";

const T = NOW.getTime();
const beat = (monitorId: number, minutesAgo: number): Beat => ({
  monitorId,
  ts: new Date(T - minutesAgo * 60_000).toISOString(),
  status: 1,
  pingMs: 10,
  msg: null,
  important: false,
});

describe("BeatBuffer (60-minute ring)", () => {
  it("dedups, orders oldest first and honours the limit", () => {
    const b = new BeatBuffer();
    b.add(beat(2, 1), T);
    b.add(beat(1, 3), T);
    b.add(beat(1, 3), T);
    b.add(beat(1, 2), T);
    expect(b.size).toBe(3);
    expect(b.take(2, T).map((x) => [x.monitorId, x.ts])).toEqual([
      [1, beat(1, 3).ts],
      [1, beat(1, 2).ts],
    ]);
  });

  it("never re-queues beats at or before the acknowledged watermark", () => {
    const b = new BeatBuffer();
    const sent = [beat(1, 5), beat(1, 4)];
    for (const x of sent) b.add(x, T);
    b.ack(b.take(10, T));
    expect(b.size).toBe(0);
    expect(b.watermark(1)).toBe(beat(1, 4).ts);
    // Kuma resends the last 100 on every login.
    for (const x of [beat(1, 6), beat(1, 5), beat(1, 4), beat(1, 3)]) b.add(x, T);
    expect(b.take(10, T).map((x) => x.ts)).toEqual([beat(1, 3).ts]);
  });

  it("keeps only the last 60 minutes while the Worker is unreachable", () => {
    const b = new BeatBuffer(60 * 60_000);
    for (let m = 0; m < 90; m++) b.add(beat(1, 89 - m), T - (89 - m) * 60_000);
    // Time passes with no successful send: the window slides.
    const later = T + 10 * 60_000;
    const left = b.take(1000, later);
    expect(left.length).toBe(51); // minutes -10 .. -89 relative to later minus the window
    expect(Date.parse(left[0]!.ts)).toBeGreaterThanOrEqual(later - 60 * 60_000);
    expect(b.dropped).toBeGreaterThan(0);
  });

  it("caps the count, dropping the oldest", () => {
    const b = new BeatBuffer(60 * 60_000, 5);
    for (let m = 10; m > 0; m--) b.add(beat(1, m), T);
    expect(b.size).toBe(5);
    expect(b.take(10, T)[0]!.ts).toBe(beat(1, 5).ts);
  });
});

describe("Collector send loop", () => {
  const ingest: IngestConfig = {
    url: "https://status.example.com/api/ingest/kuma",
    path: "/api/ingest/kuma",
    keyId: "collector-1",
    key: "test-key-not-a-secret",
    accessClientId: null,
    accessClientSecret: null,
  };

  it("keeps beats while the Worker fails, flushes them in order once it answers, then sends only new ones", async () => {
    const state = createState();
    const buffer = new BeatBuffer();
    state.onBeat = (x) => buffer.add(x, Date.now());
    applyMonitorList(state, monitorList(), true);
    const nowMin = (Date.now() - T) / 60_000;
    applyHeartbeat(state, liveBeat(1, -nowMin + 2, 1));
    applyHeartbeat(state, liveBeat(1, -nowMin + 1, 1));

    let fail = true;
    const bodies: { beats: string[] }[] = [];
    const c = new Collector({
      state,
      session: { refresh: async () => undefined, status: () => ({ reachable: true }) },
      host: "watch-1",
      aliases: new Map(),
      buffer,
      ingest,
      livenessFile: null,
      fetchImpl: async (_url, init) => {
        const snap = JSON.parse(String(init.body));
        bodies.push({ beats: snap.heartbeatsSince.map((b: { ts: string }) => b.ts) });
        return new Response(null, { status: fail ? 503 : 202 });
      },
    });

    expect((await c.tick()).kind).toBe("failed");
    expect(c.sendFailures).toBe(1);
    expect(c.nextDelayMs(60)).toBeLessThan(60_000);
    expect(buffer.size).toBe(2);

    applyHeartbeat(state, liveBeat(1, -nowMin, 0, "down"));
    expect((await c.tick()).kind).toBe("failed");
    fail = false;
    expect((await c.tick()).kind).toBe("sent");
    expect(buffer.size).toBe(0);
    expect(c.nextDelayMs(60)).toBe(60_000);

    applyHeartbeat(state, liveBeat(1, -nowMin - 1, 1));
    await c.tick();
    expect(bodies.map((b) => b.beats.length)).toEqual([2, 3, 3, 1]);
    const flushed = bodies[2]!.beats;
    expect([...flushed].sort()).toEqual(flushed);
  });
});
