/**
 * Ingest keys through the admin API and signed ingest, end to end over D1: env keys keep working, rotation
 * accepts the old key until the new one is first used (then rejects it), an env key rotates into D1, a new
 * source is added to the config with its key, secrets are sealed at rest and never logged.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { IssuedKey, SourceKeyList } from "@/shared/schemas/admin";
import { randomNonce, signRequest } from "@/shared/signing";
import { schema } from "@/worker/db";
import { resetConfigCache } from "@/worker/engine/config-store";
import { resetKeyTouches } from "@/worker/engine/key-store";
import { freshFixture } from "../ssr/seed";
import { factsPayloadFrom, kumaSnapshotFrom } from "../support/fixture-payloads";
import { testPlatform } from "../support/platform";
import { admin, adminCookie, adminEnv, handle, json } from "./admin-app";

let api: ReturnType<typeof admin>;
const { db } = testPlatform();
const issued: string[] = [];

/** A signed ingest POST (real clock, fresh fixture data) through the gates and the app. */
async function ingest(route: "kuma" | "facts", keyId: string, secret: string, e: Env = adminEnv) {
  const fx = freshFixture("default");
  const body = JSON.stringify(route === "kuma" ? kumaSnapshotFrom(fx) : factsPayloadFrom(fx));
  const path = `/api/ingest/${route}`;
  const headers = await signRequest(secret, keyId, "POST", path, body, new Date(), randomNonce());
  return handle(
    path,
    { method: "POST", body, headers: { "content-type": "application/json", ...headers } },
    e,
  );
}

const keysOf = async () => {
  const res = await api.get("/sites/demo/sources");
  expect(res.status).toBe(200);
  const text = await res.text();
  for (const s of issued) expect(text).not.toContain(s);
  return SourceKeyList.parse(JSON.parse(text)).keys;
};
const keyOf = async (keyId: string) => (await keysOf()).find((k) => k.keyId === keyId)!;

async function issue(res: Response, status = 200): Promise<IssuedKey> {
  expect(res.status).toBe(status);
  const key = IssuedKey.parse(await json(res));
  issued.push(key.secret);
  return key;
}

let logs: string[] = [];
beforeAll(async () => {
  resetConfigCache();
  resetKeyTouches();
  api = admin(await adminCookie());
});
beforeEach(() => {
  logs = [];
  const capture = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
  for (const level of ["log", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(capture);
});
afterEach(() => {
  for (const s of [...issued, adminEnv.INGEST_KEY_COLLECTOR_1, adminEnv.SOURCE_MASTER_KEY]) {
    expect(logs.join("\n")).not.toContain(s);
  }
  vi.restoreAllMocks();
});
afterAll(() => {
  resetConfigCache();
  resetKeyTouches();
});

describe("ingest keys", () => {
  it("lists the env keys without secrets, and they keep verifying (env fallback)", async () => {
    const keys = await keysOf();
    expect(keys.map((k) => [k.keyId, k.source, k.kind, k.store])).toEqual([
      ["collector-1", "kuma:watch-1", "kuma", "env"],
      ["facts-1", "facts:app-1", "facts", "env"],
    ]);
    expect(keys[0]).toMatchObject({ current: { lastUsedAt: null }, next: null });
    expect(JSON.stringify(keys)).not.toContain(adminEnv.INGEST_KEY_COLLECTOR_1);

    expect((await ingest("kuma", "collector-1", adminEnv.INGEST_KEY_COLLECTOR_1)).status).toBe(202);
    expect((await ingest("facts", "facts-1", adminEnv.INGEST_KEY_FACTS_1)).status).toBe(202);
    expect((await keyOf("collector-1")).current?.lastUsedAt).not.toBeNull();
    expect((await ingest("kuma", "collector-1", "not-the-secret")).status).toBe(401);
  });

  it("touches lastUsedAt at most once a minute", async () => {
    const before = (await keyOf("facts-1")).current!.lastUsedAt;
    expect((await ingest("facts", "facts-1", adminEnv.INGEST_KEY_FACTS_1)).status).toBe(202);
    expect((await keyOf("facts-1")).current!.lastUsedAt).toBe(before);
  });

  it("rotates an env key into D1: old accepted until the new one is used, then rejected", async () => {
    const key = await issue(await api.post("/sites/demo/sources/collector-1/rotate"));
    expect(key).toMatchObject({ keyId: "collector-1", source: "kuma:watch-1", slot: "next" });
    expect(key.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await keyOf("collector-1")).toMatchObject({
      store: "env",
      current: {},
      next: { lastUsedAt: null },
    });

    const old = adminEnv.INGEST_KEY_COLLECTOR_1;
    expect((await ingest("kuma", "collector-1", old)).status).toBe(202);
    expect((await ingest("kuma", "collector-1", key.secret)).status).toBe(202);
    expect(logs.some((l) => l.includes('"key_promoted"'))).toBe(true);
    expect(await keyOf("collector-1")).toMatchObject({ store: "d1", next: null });

    const rejected = await ingest("kuma", "collector-1", old);
    expect(rejected.status).toBe(401);
    expect(await json(rejected)).toEqual({ error: "unauthorized", reason: "bad_signature" });
    expect((await ingest("kuma", "collector-1", key.secret)).status).toBe(202);
  });

  it("adds a source to the config as a new revision and issues its key as current", async () => {
    const before = (await json(await api.get("/sites/demo/config"))).version as number;
    const key = await issue(
      await api.post("/sites/demo/sources", {
        keyId: "extra",
        source: "facts:extra",
        kind: "facts",
        expectedIntervalS: 600,
      }),
      201,
    );
    expect(key).toMatchObject({ keyId: "extra", source: "facts:extra", slot: "current" });
    const state = await json(await api.get("/sites/demo/config"));
    expect(state.version).toBe(before + 1);
    expect(state.config.sources).toContainEqual({ id: "facts:extra", kind: "facts", expectedIntervalS: 600 });
    const revisions = await json(await api.get("/sites/demo/config/revisions"));
    expect(revisions.revisions[0]).toMatchObject({ note: "Added source facts:extra", changes: 1 });
    expect(await keyOf("extra")).toMatchObject({ store: "d1", kind: "facts", next: null });

    expect((await ingest("facts", "extra", key.secret)).status).toBe(202);
    expect((await ingest("kuma", "extra", key.secret)).status).toBe(403);
  });

  it("rejects a taken key id, a source that has a key, a kind mismatch and bad bodies", async () => {
    const create = (body: unknown) => api.post("/sites/demo/sources", body);
    const base = { keyId: "fresh", source: "facts:fresh", kind: "facts", expectedIntervalS: 60 };
    for (const keyId of ["extra", "collector-1", "facts-1"]) {
      expect((await create({ ...base, keyId })).status).toBe(409);
    }
    expect((await create({ ...base, source: "facts:extra" })).status).toBe(409);
    const mismatch = await create({ ...base, kind: "kuma" });
    expect(mismatch.status).toBe(400);
    expect((await json(mismatch)).issues).toEqual([
      { path: "source", message: "Source id prefix must match its kind" },
    ]);
    expect((await create({ ...base, keyId: "Bad Id" })).status).toBe(400);
    expect((await create("nope")).status).toBe(400);
    expect((await api.post("/sites/nope/sources", base)).status).toBe(404);
  });

  it("rotates a D1 key; a second rotation before use replaces the first", async () => {
    const current = issued.at(-1)!;
    const first = await issue(await api.post("/sites/demo/sources/extra/rotate"));
    const second = await issue(await api.post("/sites/demo/sources/extra/rotate"));
    expect((await ingest("facts", "extra", first.secret)).status).toBe(401);
    expect((await ingest("facts", "extra", current)).status).toBe(202);
    expect((await ingest("facts", "extra", second.secret)).status).toBe(202);
    expect(await keyOf("extra")).toMatchObject({ store: "d1", next: null });
    expect((await ingest("facts", "extra", current)).status).toBe(401);
  });

  it("answers 404 for an unknown key id or site", async () => {
    for (const path of [
      "/sites/demo/sources/nope/rotate",
      "/sites/demo/sources/NOPE/rotate",
      "/sites/x1/sources/collector-1/rotate",
    ]) {
      expect((await api.post(path)).status, path).toBe(404);
    }
  });

  it("stores secrets sealed only, and needs the master key to open or issue them", async () => {
    const rows = await db.select().from(schema.ingestKeys);
    const dump = JSON.stringify(rows);
    expect(issued.length).toBeGreaterThanOrEqual(4);
    for (const s of issued) expect(dump).not.toContain(s);
    for (const r of rows.filter((r) => r.currentSealed)) expect(r.currentSealed).toMatch(/^v1\./);

    const noMaster = { ...adminEnv, SOURCE_MASTER_KEY: "" } as Env;
    const extra = issued.at(-1)!;
    expect((await ingest("facts", "extra", extra, noMaster)).status).toBe(401);
    expect(logs.some((l) => l.includes('"unseal"') && l.includes("MasterKeyMissing"))).toBe(true);
    const otherMaster = { ...adminEnv, SOURCE_MASTER_KEY: btoa("x".repeat(32)) } as Env;
    expect((await ingest("facts", "extra", extra, otherMaster)).status).toBe(401);
    expect((await ingest("facts", "extra", extra)).status).toBe(202);
    // Env keys do not need it.
    expect((await ingest("facts", "facts-1", adminEnv.INGEST_KEY_FACTS_1, noMaster)).status).toBe(202);

    const rotate = await handle(
      "/api/admin/sites/demo/sources/extra/rotate",
      {
        method: "POST",
        headers: { cookie: await adminCookie(), origin: "https://worker.example.net" },
      },
      noMaster,
    );
    expect(rotate.status).toBe(503);
    expect(await json(rotate)).toMatchObject({ error: "unavailable" });
  });
});
