/**
 * API keys end to end over D1: created and revoked with `sources.manage`, the secret shown once and stored
 * only as a hash, ingest with `Authorization: Bearer` (valid, wrong scope, wrong site or source, revoked),
 * reading a private site with a `read` key, and HMAC-signed ingest working unchanged next to it.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { ConfigState } from "@/shared/schemas/admin";
import { ApiKeyList, IssuedApiKey } from "@/shared/schemas/auth";
import { randomNonce, signRequest } from "@/shared/signing";
import { createDb, schema } from "@/worker/db";
import { resetConfigCache } from "@/worker/engine/config-store";
import { freshFixture } from "../ssr/seed";
import { factsPayloadFrom, kumaSnapshotFrom } from "../support/fixture-payloads";
import { admin, adminCookie, adminEnv, handle, json, send, sessionCookie, testEmail } from "./admin-app";

const db = createDb(adminEnv.DB);
let api: ReturnType<typeof admin>;

const factsBody = () => JSON.stringify(factsPayloadFrom(freshFixture("default")));
const kumaBody = () => JSON.stringify(kumaSnapshotFrom(freshFixture("default")));

/** An ingest POST with an API key. */
const bearerIngest = (route: "kuma" | "facts", key: string, source: string | null, body = factsBody()) =>
  handle(`/api/ingest/${route}`, {
    method: "POST",
    body,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(source === null ? {} : { "x-uptellis-source": source }),
    },
  });

async function createKey(scopes: string[], name = "pusher"): Promise<IssuedApiKey> {
  const res = await api.post("/sites/demo/api-keys", { name, scopes });
  expect(res.status).toBe(201);
  return IssuedApiKey.parse(await json(res));
}

beforeAll(async () => {
  resetConfigCache();
  api = admin(await adminCookie());
});

describe("managing API keys", () => {
  it("shows the key once, lists it without the secret, and stores only a hash", async () => {
    const key = await createKey(["ingest"]);
    expect(key).toMatchObject({
      site: "demo",
      name: "pusher",
      scopes: ["ingest"],
      revokedAt: null,
      lastUsedAt: null,
    });
    expect(key.key).toMatch(/^upt_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/);
    expect(key.key.startsWith(`${key.prefix}_`)).toBe(true);

    const res = await api.get("/sites/demo/api-keys");
    const text = await res.text();
    expect(text).not.toContain(key.key.split("_").pop());
    expect(ApiKeyList.parse(JSON.parse(text)).keys.map((k) => k.id)).toContain(key.id);
    const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id));
    expect(JSON.stringify(row)).not.toContain(key.key.split("_").pop());
  });

  it("validates scopes and the site", async () => {
    expect((await api.post("/sites/demo/api-keys", { name: "x", scopes: [] })).status).toBe(400);
    expect((await api.post("/sites/demo/api-keys", { name: "x", scopes: ["admin"] })).status).toBe(400);
    expect((await api.post("/sites/demo/api-keys", { name: "x", scopes: ["read", "read"] })).status).toBe(
      400,
    );
    expect((await api.post("/sites/nope/api-keys", { name: "x", scopes: ["read"] })).status).toBe(404);
    expect((await api.delete("/sites/demo/api-keys/nokey")).status).toBe(404);
  });

  it("needs sources.manage", async () => {
    const invite = await api.post("/invites", { role: "viewer" });
    const token = ((await json(invite)) as { url: string }).url.split("/").pop()!;
    const accepted = await send(`/api/invites/${token}/accept`, {
      name: "Viewer",
      email: testEmail("key-viewer"),
      password: "key-viewer-password",
    });
    const viewer = admin(sessionCookie(accepted)!);
    expect((await viewer.get("/sites/demo/api-keys")).status).toBe(403);
    expect((await viewer.post("/sites/demo/api-keys", { name: "x", scopes: ["read"] })).status).toBe(403);
    expect((await handle("/api/admin/sites/demo/api-keys")).status).toBe(401);
  });

  it("gives an API key no admin access", async () => {
    const key = await createKey(["ingest", "read"]);
    const res = await handle("/api/admin/sites/demo/api-keys", {
      headers: { authorization: `Bearer ${key.key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("ingest with an API key", () => {
  it("accepts a valid key with the ingest scope for a source of its site, and records the use", async () => {
    const key = await createKey(["ingest"]);
    const res = await bearerIngest("facts", key.key, "facts:app-1");
    expect(res.status).toBe(202);
    expect(await json(res)).toMatchObject({ ok: true, site: "demo", source: "facts:app-1" });
    const kuma = await bearerIngest("kuma", key.key, "kuma:watch-1", kumaBody());
    expect(kuma.status).toBe(202);
    const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, key.id));
    expect(row!.lastUsedAt).not.toBeNull();
  });

  it("refuses a key without the ingest scope", async () => {
    const key = await createKey(["read"]);
    const res = await bearerIngest("facts", key.key, "facts:app-1");
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "forbidden", reason: "scope" });
  });

  it("refuses a source outside the key's site, one the route does not accept, or none", async () => {
    const key = await createKey(["ingest"]);
    for (const [route, source] of [
      ["facts", "facts:elsewhere"],
      ["kuma", "facts:app-1"],
      ["facts", "not a source"],
      ["facts", null],
    ] as const) {
      const res = await bearerIngest(route, key.key, source);
      expect(res.status, `${route} ${source}`).toBe(403);
      expect(await json(res)).toEqual({ error: "forbidden", reason: "wrong_source" });
    }
  });

  it("refuses a revoked key, an unknown key and a wrong secret", async () => {
    const key = await createKey(["ingest"]);
    const revoked = await api.delete(`/sites/demo/api-keys/${key.id}`);
    expect(revoked.status).toBe(200);
    expect(((await json(revoked)) as { revokedAt: string | null }).revokedAt).not.toBeNull();
    const wrongSecret = `${key.prefix}_${"A".repeat(43)}`;
    for (const token of [key.key, wrongSecret, "upt_unknownkey00_" + "B".repeat(43), "not-a-key"]) {
      const res = await bearerIngest("facts", token, "facts:app-1");
      expect(res.status, token.slice(0, 8)).toBe(401);
      expect(await json(res)).toEqual({ error: "unauthorized", reason: "bad_api_key" });
    }
  });

  it("keeps HMAC-signed ingest working unchanged", async () => {
    const body = factsBody();
    const path = "/api/ingest/facts";
    const headers = await signRequest(
      adminEnv.INGEST_KEY_FACTS_1,
      "facts-1",
      "POST",
      path,
      body,
      new Date(),
      randomNonce(),
    );
    const res = await handle(path, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...headers },
    });
    expect(res.status).toBe(202);
  });
});

describe("reading with an API key", () => {
  it("opens a private site to a read key of that site only", async () => {
    const state = ConfigState.parse(await json(await api.get("/sites/demo/config")));
    const saved = await api.put("/sites/demo/config", {
      config: { ...state.config, visibility: "private" },
      baseVersion: state.version,
    });
    expect(saved.status).toBe(200);
    resetConfigCache();

    const reader = await createKey(["read"]);
    const pusher = await createKey(["ingest"]);
    const view = (key?: string) =>
      handle("/api/sites/demo/view", key ? { headers: { authorization: `Bearer ${key}` } } : {});
    expect((await view()).status).toBe(404);
    expect((await view(pusher.key)).status).toBe(404);
    expect((await view(reader.key)).status).toBe(200);
    await api.delete(`/sites/demo/api-keys/${reader.id}`);
    expect((await view(reader.key)).status).toBe(404);
  });
});
