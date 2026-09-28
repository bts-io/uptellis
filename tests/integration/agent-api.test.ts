/**
 * The agent API end to end in workerd over the migrated D1: a site config declaring agent `office-1` and
 * its monitors (saved through the admin API), an API key with the `agent` scope, `GET /monitors` with its
 * ETag, and `POST /results` through `applyResults` into services, heartbeats, incidents, runner states and
 * source freshness. Refusals: 401, 403 (scope, unknown runner), 413, 400.
 */
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { AGENT_API_PREFIX, AgentMonitorsResponse, MAX_RESULTS_BYTES } from "@/shared/monitors";
import { ConfigState } from "@/shared/schemas/admin";
import { IssuedApiKey } from "@/shared/schemas/auth";
import { schema } from "@/worker/db";
import { resetConfigCache } from "@/worker/engine/config-store";
import { testPlatform } from "../support/platform";
import { admin, adminCookie, handle, json } from "./admin-app";

const { db } = testPlatform();
let api: ReturnType<typeof admin>;
let agentKey: IssuedApiKey;

const MONITORS = [
  {
    id: "nas",
    name: "NAS",
    type: "tcp",
    host: "nas.lan",
    port: 445,
    retries: 0,
    intervalS: 120,
    runners: ["office-1"],
  },
  {
    id: "site",
    name: "Site",
    type: "http",
    url: "https://example.com/",
    retries: 0,
    intervalS: 180,
    runners: ["builtin", "office-1"],
  },
  { id: "paused", name: "Paused", type: "ping", host: "nas.lan", runners: ["office-1"], enabled: false },
];

async function createKey(scopes: string[]): Promise<IssuedApiKey> {
  const res = await api.post("/sites/demo/api-keys", { name: "agent", scopes });
  expect(res.status).toBe(201);
  return IssuedApiKey.parse(await json(res));
}

const call = (
  path: "monitors" | "results",
  key: string | null,
  runner: string | null,
  init: RequestInit = {},
) =>
  handle(`${AGENT_API_PREFIX}/${path}`, {
    ...init,
    headers: {
      ...(key === null ? {} : { authorization: `Bearer ${key}` }),
      ...(runner === null ? {} : { "x-uptellis-runner": runner }),
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.headers as Record<string, string> | undefined),
    },
  });

const post = (body: unknown, key = agentKey.key, runner = "office-1") =>
  call("results", key, runner, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const iso = (t: number) => new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
const batch = (results: unknown[]) => ({
  v: 1,
  agent: "uptellis-agent/0.3.0",
  sentAt: iso(Date.now()),
  results,
});

beforeAll(async () => {
  resetConfigCache();
  api = admin(await adminCookie());
  const state = ConfigState.parse(await json(await api.get("/sites/demo/config")));
  const saved = await api.put("/sites/demo/config", {
    config: { ...state.config, agents: [{ id: "office-1", name: "Office" }], monitors: MONITORS },
    baseVersion: state.version,
  });
  expect(saved.status).toBe(200);
  resetConfigCache();
  agentKey = await createKey(["agent"]);
});

describe("agent API: refusals", () => {
  it("answers 401 without a valid, unrevoked key", async () => {
    const revoked = await createKey(["agent"]);
    await api.delete(`/sites/demo/api-keys/${revoked.id}`);
    const wrongSecret = `${agentKey.prefix}_${"A".repeat(43)}`;
    for (const key of [null, "not-a-key", wrongSecret, revoked.key]) {
      const res = await call("monitors", key, "office-1");
      expect(res.status, String(key).slice(0, 8)).toBe(401);
      expect(await json(res)).toEqual({ error: "unauthorized", reason: "bad_api_key" });
    }
    expect((await post(batch([]), wrongSecret)).status).toBe(401);
  });

  it("answers 403 without the agent scope or for a runner the site does not declare", async () => {
    const ingest = await createKey(["ingest", "read"]);
    const res = await call("monitors", ingest.key, "office-1");
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: "forbidden", reason: "scope" });
    for (const runner of [null, "office-9", "builtin", "Not An Id"]) {
      const r = await call("monitors", agentKey.key, runner);
      expect(r.status, String(runner)).toBe(403);
      expect(await json(r)).toEqual({ error: "forbidden", reason: "unknown_runner" });
    }
    expect((await post(batch([]), agentKey.key, "office-9")).status).toBe(403);
  });

  it("answers 413 over the size cap and 400 for bad JSON or a bad batch", async () => {
    const big = JSON.stringify({ pad: "x".repeat(MAX_RESULTS_BYTES) });
    const tooLarge = await post(big);
    expect(tooLarge.status).toBe(413);
    expect(await json(tooLarge)).toEqual({ error: "payload_too_large", maxBytes: MAX_RESULTS_BYTES });

    const notJson = await post("{nope");
    expect(notJson.status).toBe(400);
    expect(await json(notJson)).toEqual({ error: "invalid_json" });

    const invalid = await post({ v: 1, agent: "uptellis-agent/0.3.0", sentAt: iso(Date.now()), results: [] });
    expect(invalid.status).toBe(400);
    const body = (await json(invalid)) as { error: string; issues: { path: string }[] };
    expect(body.error).toBe("invalid_payload");
    expect(body.issues.map((i) => i.path)).toEqual(["results"]);
  });
});

describe("agent API: GET /monitors", () => {
  it("lists the agent's enabled monitors with an ETag, 304 on a match, and records the key's use", async () => {
    const res = await call("monitors", agentKey.key, "office-1");
    expect(res.status).toBe(200);
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    const body = AgentMonitorsResponse.parse(await json(res));
    expect(body).toMatchObject({ v: 1, site: "demo", runner: "office-1", pollS: 60 });
    expect(body.monitors.map((m) => m.id)).toEqual(["nas", "site"]);

    const same = await call("monitors", agentKey.key, "office-1", { headers: { "if-none-match": etag! } });
    expect(same.status).toBe(304);
    expect(same.headers.get("etag")).toBe(etag);
    expect(await same.text()).toBe("");
    const other = await call("monitors", agentKey.key, "office-1", { headers: { "if-none-match": '"x"' } });
    expect(other.status).toBe(200);

    const [row] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, agentKey.id));
    expect(row!.lastUsedAt).not.toBeNull();
  });
});

describe("agent API: POST /results", () => {
  it("applies results as probe:office-1, opens an incident, and ignores the rest", async () => {
    const t = Math.floor(Date.now() / 1000) * 1000 - 30_000;
    const res = await post(
      batch([
        { monitorId: "site", ts: iso(t), status: "up", latencyMs: 80, message: "HTTP 200" },
        { monitorId: "nas", ts: iso(t), status: "down", latencyMs: null, message: "connection refused" },
        { monitorId: "paused", ts: iso(t), status: "up", latencyMs: 3, message: "ok" },
        { monitorId: "web-app", ts: iso(t), status: "up", latencyMs: 3, message: "HTTP 200" },
        { monitorId: "gone", ts: iso(t), status: "up", latencyMs: 3, message: "ok" },
      ]),
    );
    expect(res.status).toBe(202);
    expect(await json(res)).toEqual({ accepted: 2, ignored: 3 });

    const again = await post(
      batch([{ monitorId: "nas", ts: iso(t), status: "up", latencyMs: 2, message: "ok" }]),
    );
    expect(await json(again)).toEqual({ accepted: 0, ignored: 1 });

    const services = await db
      .select({
        id: schema.services.id,
        source: schema.services.source,
        status: schema.services.status,
        target: schema.services.targetDisplay,
      })
      .from(schema.services)
      .where(and(eq(schema.services.site, "demo"), eq(schema.services.kind, "port")));
    expect(services).toEqual([{ id: "probe:nas", source: "probe:office-1", status: "down", target: null }]);
    const [site] = await db
      .select({ source: schema.services.source, status: schema.services.status })
      .from(schema.services)
      .where(and(eq(schema.services.site, "demo"), eq(schema.services.id, "probe:site")));
    expect(site).toEqual({ source: "probe:cf", status: "up" });

    const open = await db
      .select({ id: schema.incidents.id })
      .from(schema.incidents)
      .where(and(eq(schema.incidents.site, "demo"), eq(schema.incidents.serviceId, "probe:nas")));
    expect(open).toEqual([{ id: `probe:nas:${iso(t)}` }]);

    const [source] = await db
      .select()
      .from(schema.sources)
      .where(and(eq(schema.sources.site, "demo"), eq(schema.sources.id, "probe:office-1")));
    // Implied by the config: the smallest interval of the agent's monitors.
    expect(source).toMatchObject({ kind: "probe", expectedIntervalS: 120 });
    expect(source!.lastSeenAt).not.toBeNull();

    const states = await db
      .select()
      .from(schema.monitorRunners)
      .where(eq(schema.monitorRunners.runner, "office-1"))
      .orderBy(asc(schema.monitorRunners.monitorId));
    expect(states.map((s) => [s.monitorId, s.lastTs, s.lastStatus, s.consecutiveDown])).toEqual([
      ["nas", t, "down", 1],
      ["site", t, "up", 0],
    ]);
  });
});
