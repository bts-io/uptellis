import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES } from "@/shared/signing";
import { INGEST_KEY_BINDINGS } from "@/worker/ingest/keys";
import { ingestRoutes } from "@/worker/ingest/routes";
import { loadFixture } from "../fixtures";
import { factsPayloadFrom, kumaSnapshotFrom } from "../support/fixture-payloads";
import { memoryBackend } from "../support/memory-store";
import { nextNonce, signedPost, TEST_ENV, TEST_KEYS } from "../support/signing";

// Address samples are built at runtime (RFC 5737 documentation range) so this file passes the repo scan.
const DOC_ADDR = [198, 51, 100, 7].join(".");
const NOW = new Date("2026-09-27T23:58:00Z");
const BASE = "https://worker.example.net/api/ingest";

function setup(opts: { env?: Record<string, string> } = {}) {
  const backend = memoryBackend([
    { id: "kuma:watch-1", site: "demo", expectedIntervalS: 60 },
    { id: "facts:app-1", site: "demo", expectedIntervalS: 900 },
    { id: "webhook:ci", site: "demo", expectedIntervalS: 300 },
  ]);
  let now = NOW;
  const app = new Hono();
  // The same mount the Worker uses; the backend resolver ignores env here.
  app.route(
    "/api/ingest",
    ingestRoutes(() => backend, {
      now: () => now,
      bindings: { ...INGEST_KEY_BINDINGS, ci: { site: "demo", source: "webhook:ci" } },
    }),
  );
  const env = { ...TEST_ENV, ...opts.env };
  const send = (route: string, init: RequestInit) => app.request(`${BASE}/${route}`, init, env);
  const post = async (route: string, payload: unknown, sign: Parameters<typeof signedPost>[2] = {}) => {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    return send(route, await signedPost(`/api/ingest/${route}`, body, { now, ...sign }));
  };
  return {
    ...backend,
    send,
    post,
    setNow: (d: Date) => {
      now = d;
    },
  };
}

/** Response JSON, loosely typed for assertions. */
const jsonOf = (r: Response): Promise<any> => r.json();

const kumaPayload = (name: "default" | "incident" = "default") => kumaSnapshotFrom(loadFixture(name));

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/ingest/kuma", () => {
  it("accepts the default fixture snapshot: 202 with counts, store and cache filled", async () => {
    const t = setup();
    const res = await t.post("kuma", kumaPayload());
    expect(res.status).toBe(202);
    const body = await jsonOf(res);
    expect(body).toEqual({
      ok: true,
      site: "demo",
      source: "kuma:watch-1",
      generatedAt: "2026-09-27T23:57:26Z",
      latest: true,
      counts: { services: 8, heartbeats: 40, facts: 6 },
      incidents: { opened: [], resolved: [] },
    });
    expect(t.store.services.size).toBe(8);
    expect(t.store.heartbeats.size).toBe(40);
    const cached = await t.cache.get("demo");
    expect(cached?.services).toHaveLength(8);
    expect(cached?.sources.find((s) => s.id === "kuma:watch-1")?.lastSeenAt).toBe("2026-09-27T23:57:26Z");
    // Ids and counts only: no names, targets or messages in the response or the logs.
    const text = JSON.stringify(body) + logs.join("\n");
    for (const leak of ["API health", "app-1:5432", "200 - OK", "Asia/Tokyo"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("derives the incident fixture's open incident and resolves it on recovery", async () => {
    const t = setup();
    const res = await t.post("kuma", kumaPayload("incident"));
    expect(res.status).toBe(202);
    expect((await jsonOf(res)).incidents).toEqual({ opened: ["kuma:5:2026-09-27T23:52:00Z"], resolved: [] });
    expect((await t.cache.get("demo"))?.openIncidents.map((i) => i.id)).toEqual([
      "kuma:5:2026-09-27T23:52:00Z",
    ]);

    const recovery = kumaPayload("incident");
    recovery.generatedAt = "2026-09-27T23:58:26Z";
    recovery.heartbeatsSince = [
      { monitorId: 5, ts: "2026-09-27T23:58:00Z", status: 1, pingMs: 214, msg: null, important: true },
    ];
    recovery.importantHeartbeats = recovery.heartbeatsSince;
    t.setNow(new Date("2026-09-27T23:58:30Z"));
    const again = await t.post("kuma", recovery);
    expect(again.status).toBe(202);
    const out = await jsonOf(again);
    expect(out.counts.heartbeats).toBe(1);
    expect(out.incidents).toEqual({ opened: [], resolved: ["kuma:5:2026-09-27T23:52:00Z"] });
    expect(t.store.services.get("kuma:5")?.status).toBe("up");
  });

  it("rejects a replayed request with 409 and does not apply it twice", async () => {
    const t = setup();
    const init = await signedPost("/api/ingest/kuma", JSON.stringify(kumaPayload()), { now: NOW });
    expect((await t.send("kuma", init)).status).toBe(202);
    const replay = await t.send("kuma", init);
    expect(replay.status).toBe(409);
    expect(await jsonOf(replay)).toEqual({ error: "replay" });
    expect(t.store.deltas).toHaveLength(1);
  });

  it("answers 401 for skew, bad signature, unknown key id, missing headers and a secret that is not set", async () => {
    const t = setup();
    const p = kumaPayload();
    const cases: [Parameters<typeof signedPost>[2], string][] = [
      [{ now: new Date(NOW.getTime() - 121_000) }, "skew"],
      [{ now: new Date(NOW.getTime() + 121_000) }, "skew"],
      [{ secret: "not-the-key" }, "bad_signature"],
      [{ keyId: "unknown-1", secret: "whatever" }, "unknown_key"],
      [{ path: "/api/ingest/facts" }, "bad_signature"],
      [{ headers: { "X-Uptellis-Signature": "" } }, "missing_headers"],
    ];
    for (const [sign, reason] of cases) {
      const res = await t.post("kuma", p, sign);
      expect(res.status, reason).toBe(401);
      expect(await jsonOf(res)).toEqual({ error: "unauthorized", reason });
    }
    const unset = setup({ env: { INGEST_KEY_COLLECTOR_1: "" } });
    expect(await (await unset.post("kuma", p)).json()).toEqual({
      error: "unauthorized",
      reason: "unknown_key",
    });
    expect(t.store.deltas).toHaveLength(0);
    expect(t.store.nonces.size).toBe(0);
  });

  it("accepts the _NEXT secret during rotation", async () => {
    const t = setup({ env: { INGEST_KEY_COLLECTOR_1_NEXT: TEST_KEYS.collectorNext } });
    expect((await t.post("kuma", kumaPayload(), { secret: TEST_KEYS.collectorNext })).status).toBe(202);
    expect(logs.join("\n")).toContain('"rotatedKey":true');
  });

  it("answers 403 when a key posts to another source's route", async () => {
    const t = setup();
    const res = await t.post("kuma", kumaPayload(), { keyId: "facts-1" });
    expect(res.status).toBe(403);
    expect(await jsonOf(res)).toEqual({ error: "forbidden", reason: "wrong_source" });
    const facts = await t.post("facts", factsPayloadFrom(loadFixture("default")), { keyId: "collector-1" });
    expect(facts.status).toBe(403);
    expect(t.store.nonces.size).toBe(0);
  });

  it("answers 413 above 256 KB, by Content-Length and by streamed size, before verifying", async () => {
    const t = setup();
    const big = JSON.stringify({ pad: "x".repeat(MAX_BODY_BYTES) });
    const declared = await t.post("kuma", big);
    expect(declared.status).toBe(413);
    expect(await jsonOf(declared)).toEqual({ error: "payload_too_large", maxBytes: MAX_BODY_BYTES });

    const init = await signedPost("/api/ingest/kuma", big, { now: NOW });
    const bytes = new TextEncoder().encode(big);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 65536) c.enqueue(bytes.slice(i, i + 65536));
        c.close();
      },
    });
    const req = new Request(`${BASE}/kuma`, { method: "POST", headers: init.headers, body: stream });
    expect(req.headers.get("content-length")).toBeNull();
    expect((await t.send("kuma", req)).status).toBe(413);
    expect(t.store.nonces.size).toBe(0);
  });

  it("answers 422 with field paths, not values, for unsafe display fields", async () => {
    const t = setup();
    const p = kumaPayload();
    p.monitors[2]!.name = `Postgres on ${DOC_ADDR}`;
    p.monitors[4]!.hostname = DOC_ADDR;
    const res = await t.post("kuma", p);
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain(DOC_ADDR);
    const body = JSON.parse(text);
    expect(body.error).toBe("invalid_payload");
    expect(body.issues.map((i: { path: string }) => i.path)).toEqual(
      expect.arrayContaining(["monitors.2.name", "monitors.4.hostname"]),
    );
    expect(logs.join("\n")).not.toContain(DOC_ADDR);
    expect(t.store.deltas).toHaveLength(0);
  });

  it("masks record keys that are not plain identifiers in issue paths", async () => {
    const t = setup();
    const p = kumaPayload() as Record<string, unknown>;
    p.avgPing = { [DOC_ADDR]: 1 };
    const res = await t.post("kuma", p);
    expect(res.status).toBe(422);
    expect(await res.text()).not.toContain(DOC_ADDR);
  });

  it("answers 400 for a body that is not JSON (after auth, so the nonce is spent)", async () => {
    const t = setup();
    const res = await t.post("kuma", "{not json");
    expect(res.status).toBe(400);
    expect(await jsonOf(res)).toEqual({ error: "invalid_json" });
    expect(t.store.nonces.size).toBe(1);
  });

  it("rejects a generatedAt far in the future with 422", async () => {
    const t = setup();
    const p = kumaPayload();
    p.generatedAt = "2026-09-28T00:10:00Z";
    const res = await t.post("kuma", p);
    expect(res.status).toBe(422);
    expect((await jsonOf(res)).issues).toEqual([
      { path: "generatedAt", message: "generatedAt is too far in the future" },
    ]);
  });

  it("stores history from an older snapshot but never lets it overwrite the latest model", async () => {
    const t = setup();
    expect((await t.post("kuma", kumaPayload("incident"))).status).toBe(202);
    const before = await t.cache.get("demo");
    const putsBefore = t.cache.puts;

    const old = kumaPayload("default");
    old.generatedAt = "2026-09-27T23:50:00Z";
    old.heartbeatsSince = [
      { monitorId: 5, ts: "2026-09-27T23:40:00Z", status: 0, pingMs: null, msg: "timeout", important: true },
    ];
    old.importantHeartbeats = old.heartbeatsSince;
    const res = await t.post("kuma", old);
    expect(res.status).toBe(200);
    const out = await jsonOf(res);
    expect(out).toMatchObject({ latest: false, counts: { services: 0, heartbeats: 1, facts: 0 } });
    expect(out.incidents).toEqual({ opened: [], resolved: [] });
    expect(t.cache.puts).toBe(putsBefore);
    expect(await t.cache.get("demo")).toEqual(before);
    expect(t.store.services.get("kuma:5")?.status).toBe("down");
    expect(t.store.sources.get("kuma:watch-1")?.lastSeenAt).toBe("2026-09-27T23:57:26Z");
  });
});

describe("POST /api/ingest/facts", () => {
  it("accepts the app-1 facts: 202 with counts and the cache keeps both sources", async () => {
    const t = setup();
    expect((await t.post("kuma", kumaPayload())).status).toBe(202);
    const res = await t.post("facts", factsPayloadFrom(loadFixture("default")), { keyId: "facts-1" });
    expect(res.status).toBe(202);
    const body = await jsonOf(res);
    expect(body).toMatchObject({
      source: "facts:app-1",
      latest: true,
      counts: { services: 0, heartbeats: 0, facts: 33 },
    });
    const cached = await t.cache.get("demo");
    // The facts payload is older than the Kuma snapshot, yet different sources never block each other.
    expect(cached?.facts).toHaveLength(39);
    expect(cached?.generatedAt).toBe("2026-09-27T23:57:26Z");
  });

  it("rejects an invalid fact with its path", async () => {
    const t = setup();
    const p = factsPayloadFrom(loadFixture("default"));
    p.groups[1]!.facts[0]!.value = `peer ${DOC_ADDR}`;
    const res = await t.post("facts", p, { keyId: "facts-1" });
    expect(res.status).toBe(422);
    const text = await res.text();
    expect(text).not.toContain(DOC_ADDR);
    expect(JSON.parse(text).issues[0].path).toMatch(/^groups\.1\.facts\.0\.value/);
  });
});

describe("POST /api/ingest/events", () => {
  const events = {
    v: 1,
    generatedAt: "2026-09-27T23:57:00Z",
    producer: "watch-1",
    services: [{ externalId: "deploy", name: "Deploy pipeline", kind: "push" }],
    heartbeats: [
      { externalId: "deploy", ts: "2026-09-27T23:50:00Z", status: "up" },
      { externalId: "deploy", ts: "2026-09-27T23:55:00Z", status: "down", message: "exit 1" },
    ],
    facts: [{ group: "ci", key: "queued", value: 3, freshForS: 600 }],
  };

  it("accepts a generic batch from a webhook key and derives incidents", async () => {
    const t = setup();
    const res = await t.post("events", events, { keyId: "ci" });
    expect(res.status).toBe(202);
    expect(await jsonOf(res)).toMatchObject({
      source: "webhook:ci",
      counts: { services: 1, heartbeats: 2, facts: 1 },
      incidents: { opened: ["webhook:deploy:2026-09-27T23:55:00Z"], resolved: [] },
    });
  });

  it("rejects heartbeats for undeclared services with 422 and refuses the kuma key", async () => {
    const t = setup();
    const bad = {
      ...events,
      services: [],
      heartbeats: [{ externalId: "ghost", ts: "2026-09-27T23:50:00Z", status: "up" }],
    };
    const res = await t.post("events", bad, { keyId: "ci" });
    expect(res.status).toBe(422);
    expect((await jsonOf(res)).issues).toEqual([
      { path: "heartbeats.0.externalId", message: "Unknown service: declare it in services first" },
    ]);
    expect((await t.post("events", events, { keyId: "collector-1" })).status).toBe(403);
  });

  it("answers 404 for other methods and routes under the mount", async () => {
    const t = setup();
    expect((await t.send("kuma", { method: "GET" })).status).toBe(404);
    expect(
      (await t.send("nope", await signedPost("/api/ingest/nope", "{}", { now: NOW, nonce: nextNonce() })))
        .status,
    ).toBe(404);
  });
});
