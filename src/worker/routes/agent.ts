/**
 * The agent API (`AGENT_API_PREFIX`, src/shared/monitors/api.ts) as a Hono sub-app: what `uptellis-agent`
 * polls and where it posts results. Both endpoints take `Authorization: Bearer <API key>` (resolved into an
 * API key principal by the accounts middleware) and `X-Uptellis-Runner: <agent id>`. Order of checks:
 *
 * 1. no valid, unrevoked API key -> 401 `bad_api_key`
 * 2. the key over the `ingest` limiter (keyed by key id) -> 429
 * 3. no `agent` scope -> 403 `scope`; the runner is not an agent declared in the key's site -> 403
 *    `unknown_runner`
 * 4. `GET /monitors`: the enabled monitors listing that agent (`AgentMonitorsResponse`) with a strong ETag
 *    over them; a matching `If-None-Match` -> 304
 * 5. `POST /results`: over `MAX_RESULTS_BYTES` -> 413 (Content-Length first, then a capped read); not JSON
 *    -> 400 `invalid_json`; not a `ResultsBatch` -> 400 `invalid_payload` with field paths; else
 *    `applyResults` for that agent -> 202 `ResultsAccepted`
 *
 * An accepted request touches the key's `lastUsedAt` (best effort, at most once a minute). Logs carry
 * reason codes, the key id, the runner and counts; never a key, a body or a monitor target.
 */
import { type Context, Hono } from "hono";
import type { Platform } from "@/platform/types";
import type { SiteConfig } from "@/shared/config";
import {
  AgentId,
  AgentMonitorsResponse,
  MAX_RESULTS_BYTES,
  type MonitorConfig,
  monitorsOf,
  ResultsAccepted,
  ResultsBatch,
  RUNNER_HEADER,
} from "@/shared/monitors";
import type { AppEnv } from "@/worker/app-env";
import { readCapped, TooLarge } from "@/worker/read-capped";
import { isoSeconds } from "../adapters/common";
import { touchApiKey } from "../auth/api-keys";
import { accountsOf, principalOf } from "../auth/context";
import { getSiteConfig } from "../engine/sites";
import { zodIssues } from "../ingest/issues";
import { tooManyRequests } from "../middleware/rate-limit";
import { applyResults, type MonitorsBackend } from "../monitors/apply";

/** How often an agent polls `/monitors` and flushes its results. */
export const AGENT_POLL_S = 60;

export interface AgentRouteOptions {
  /** Clock for tests; defaults to the platform's (`Platform.now`). */
  now?: () => Date;
}

/** Builds the store, cache, configs and runner states for a request's platform. */
export type MonitorsBackendResolver = (platform: Platform) => MonitorsBackend;

type Route = "monitors" | "results";

const log = (fields: Record<string, string | number | boolean>) =>
  console.log(JSON.stringify({ evt: "agent", ...fields }));

const reject = (status: 400 | 401 | 403 | 413, error: string, extra: object = {}) =>
  Response.json({ error, ...extra }, { status, headers: { "cache-control": "no-store" } });

/** The agent's monitors: enabled ones listing it among their runners, in config order (never a push monitor). */
export const agentMonitors = (config: SiteConfig, runner: string): MonitorConfig[] =>
  monitorsOf(config).filter((m) => m.enabled && m.type !== "push" && m.runners.includes(runner));

/** A strong ETag over the monitors' JSON (SHA-256, hex). */
export async function monitorsEtag(monitors: readonly MonitorConfig[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(monitors));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `"${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}"`;
}

/** True when `If-None-Match` names `etag` (or `*`); a weak form of it matches too (RFC 9110 13.1.2). */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((t) => {
    const tag = t.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });
}

type Caller =
  | { ok: true; site: string; runner: string; keyId: string; config: SiteConfig; touch: () => Promise<void> }
  | { ok: false; res: Response };

/** Steps 1 to 3 of the header. */
async function authorize(c: Context<AppEnv>, route: Route, backend: MonitorsBackend): Promise<Caller> {
  const principal = principalOf(c);
  if (principal.kind !== "apiKey") {
    log({ route, status: 401, reason: "bad_api_key" });
    return { ok: false, res: reject(401, "unauthorized", { reason: "bad_api_key" }) };
  }
  const keyId = `api:${principal.keyId}`;
  const limiter = c.var.platform.rateLimiter("ingest");
  if (limiter && !(await limiter.limit(keyId))) {
    log({ route, status: 429, reason: "rate_limited", keyId });
    return { ok: false, res: tooManyRequests(new URL(c.req.url).pathname) };
  }
  if (!principal.scopes.includes("agent")) {
    log({ route, status: 403, reason: "scope", keyId });
    return { ok: false, res: reject(403, "forbidden", { reason: "scope" }) };
  }
  const runner = AgentId.safeParse(c.req.header(RUNNER_HEADER) ?? "");
  const config = await getSiteConfig(backend.configs, principal.site);
  if (!runner.success || !config?.agents.some((a) => a.id === runner.data)) {
    log({ route, status: 403, reason: "unknown_runner", keyId });
    return { ok: false, res: reject(403, "forbidden", { reason: "unknown_runner" }) };
  }
  const accounts = accountsOf(c);
  return {
    ok: true,
    site: principal.site,
    runner: runner.data,
    keyId,
    config,
    touch: async () => {
      if (accounts) await touchApiKey(accounts.platform, principal.keyId);
    },
  };
}

const touched = (caller: Extract<Caller, { ok: true }>, route: Route) =>
  caller.touch().catch((err: unknown) =>
    console.warn(
      JSON.stringify({
        evt: "agent",
        route,
        step: "touch",
        keyId: caller.keyId,
        name: err instanceof Error ? err.name : "unknown",
      }),
    ),
  );

/**
 * The agent sub-app. `backend` builds the store, cache, configs and runner states for the request (the
 * SQL + KV implementation in the app).
 */
export function agentRoutes(backend: MonitorsBackendResolver, options: AgentRouteOptions = {}) {
  const app = new Hono<AppEnv>();
  const clock = (c: Context<AppEnv>) => options.now?.() ?? new Date(c.var.platform.now());

  app.get("/monitors", async (c) => {
    const deps = backend(c.var.platform);
    const caller = await authorize(c, "monitors", deps);
    if (!caller.ok) return caller.res;
    const { site, runner, keyId } = caller;
    const monitors = agentMonitors(caller.config, runner);
    const etag = await monitorsEtag(monitors);
    await touched(caller, "monitors");
    const headers = { etag, "cache-control": "no-store" };
    if (etagMatches(c.req.header("if-none-match"), etag)) {
      log({ route: "monitors", status: 304, keyId, runner });
      return c.body(null, 304, headers);
    }
    const body = AgentMonitorsResponse.parse({
      v: 1,
      site,
      runner,
      generatedAt: isoSeconds(clock(c)),
      monitors,
      pollS: AGENT_POLL_S,
    });
    log({ route: "monitors", status: 200, keyId, runner, monitors: monitors.length });
    return c.json(body, 200, headers);
  });

  app.post("/results", async (c) => {
    const deps = backend(c.var.platform);
    const caller = await authorize(c, "results", deps);
    if (!caller.ok) return caller.res;
    const { site, runner, keyId } = caller;

    let body: Uint8Array<ArrayBuffer>;
    try {
      body = await readCapped(c.req.raw, MAX_RESULTS_BYTES);
    } catch (e) {
      if (!(e instanceof TooLarge)) throw e;
      log({ route: "results", status: 413, reason: "too_large", keyId, runner });
      return reject(413, "payload_too_large", { maxBytes: MAX_RESULTS_BYTES });
    }
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body));
    } catch {
      log({ route: "results", status: 400, reason: "invalid_json", keyId, runner });
      return reject(400, "invalid_json");
    }
    const batch = ResultsBatch.safeParse(json);
    if (!batch.success) {
      const issues = zodIssues(batch.error);
      log({ route: "results", status: 400, reason: "invalid_payload", keyId, runner, issues: issues.length });
      return reject(400, "invalid_payload", { issues });
    }

    const out = await applyResults(
      deps,
      { site, runner, runtime: c.var.platform.runtime },
      batch.data.results,
      clock(c),
    );
    log({
      route: "results",
      status: 202,
      keyId,
      runner,
      accepted: out.accepted,
      ignored: out.ignored,
      opened: out.incidents.opened.length,
      resolved: out.incidents.resolved.length,
    });
    await touched(caller, "results");
    return c.json(ResultsAccepted.parse({ accepted: out.accepted, ignored: out.ignored }), 202, {
      "cache-control": "no-store",
    });
  });

  return app;
}
