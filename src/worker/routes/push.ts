/**
 * The push URL of push monitors (src/worker/monitors/push.ts), mounted at `/api/push`: `GET` or `POST
 * /api/push/<token>`, the Uptime Kuma push shape. Anonymous by design (mounted before the principal
 * middleware): the token is the credential. Parameters, from the query and for POST also from a form or
 * JSON body (the body wins):
 *
 * - `status`: `up` (default) or `down`;
 * - `msg`: the check message, at most 200 characters, with anything that is not display-safe (an address,
 *   an email, a token) replaced (`scrubForbiddenLiterals`); empty is `OK` for up and `down` for down;
 * - `ping`: whole milliseconds, the latency; anything else is ignored.
 *
 * Answers: 200 `{ ok: true }` once the push is applied (as runner `push`, through `applyResults`); 404
 * `{ ok: false }` for a malformed, unknown or rotated token and for a monitor that is removed, no longer a
 * push monitor or paused, all alike; 429 over the `push` limiter (one push per 10 s per token, keyed by the
 * token's hash); 400 `{ ok: false }` for a `status` other than up or down, 413 for a body over 4 KiB. Every
 * answer is `no-store`. Logs carry the outcome, site and monitor id; never the token, its hash, the path or
 * the message.
 */
import { type Context, Hono } from "hono";
import { type Platform, RATE_LIMITERS } from "@/platform/types";
import { ShortMessage, scrubForbiddenLiterals } from "@/shared/model";
import { type CheckResult, monitorsOf, PUSH_RUNNER } from "@/shared/monitors";
import type { AppEnv } from "@/worker/app-env";
import { readCapped, TooLarge } from "@/worker/read-capped";
import { isoSeconds } from "../adapters/common";
import { hashToken } from "../auth/tokens";
import { getSiteConfig } from "../engine/sites";
import { applyResults, type MonitorsBackend } from "../monitors/apply";
import { PUSH_TOKEN_RE, PushTokenStore } from "../monitors/push-store";

/** Largest accepted POST body. */
export const MAX_PUSH_BYTES = 4 * 1024;
/** Longest stored message. */
export const MAX_PUSH_MSG = 200;

export interface PushRouteOptions {
  /** Clock for tests; defaults to the platform's (`Platform.now`). */
  now?: () => Date;
}

type Outcome =
  | "ok"
  | "unknown_token"
  | "unknown_monitor"
  | "paused"
  | "rate_limited"
  | "invalid"
  | "too_large";

const log = (fields: Record<string, string | number>) =>
  console.log(JSON.stringify({ evt: "push", ...fields }));

const answer = (status: 200 | 400 | 404 | 413 | 429, extra: Record<string, string> = {}) =>
  Response.json({ ok: status === 200 }, { status, headers: { "cache-control": "no-store", ...extra } });

/** The push parameters as sent (strings), query first, the body over it. */
type Params = { status?: string; msg?: string; ping?: string };

const pick = (get: (name: string) => unknown): Params => {
  const out: Params = {};
  for (const k of ["status", "msg", "ping"] as const) {
    const v = get(k);
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = String(v);
  }
  return out;
};

/** A POST body's parameters (form, multipart or JSON; anything else is ignored). */
async function bodyParams(req: Request): Promise<Params> {
  const bytes = await readCapped(req, MAX_PUSH_BYTES);
  if (bytes.byteLength === 0) return {};
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  const text = new TextDecoder().decode(bytes);
  try {
    if (type.includes("application/json")) {
      const json: unknown = JSON.parse(text);
      return json && typeof json === "object" ? pick((k) => (json as Record<string, unknown>)[k]) : {};
    }
    if (type.includes("multipart/form-data")) {
      const form = await new Response(bytes, { headers: { "content-type": type } }).formData();
      return pick((k) => form.get(k));
    }
    if (type.includes("application/x-www-form-urlencoded") || type === "") {
      const form = new URLSearchParams(text);
      return pick((k) => form.get(k) ?? undefined);
    }
  } catch {
    // A body that does not parse carries no parameters; the query still counts.
  }
  return {};
}

/** The check message a push stores: display-safe, at most `MAX_PUSH_MSG` characters, never empty. */
export function pushMessage(raw: string | undefined, status: "up" | "down"): string {
  const fallback = status === "up" ? "OK" : "down";
  // Control characters and runs of white space become one space.
  const clean = scrubForbiddenLiterals(
    (raw ?? "")
      .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim(),
  )
    .slice(0, MAX_PUSH_MSG)
    .trim();
  return clean && ShortMessage.safeParse(clean).success ? clean : fallback;
}

/** `ping` as whole milliseconds, or null (absent, empty, negative or not a number). */
export function pushLatency(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,9}(?:\.\d+)?$/.test(raw.trim())) return null;
  return Math.round(Number(raw.trim()));
}

/** The push sub-app; `backend` builds the store, cache, configs and runner states for a request's platform. */
export function pushRoutes(backend: (platform: Platform) => MonitorsBackend, options: PushRouteOptions = {}) {
  const app = new Hono<AppEnv>();
  const clock = (c: Context<AppEnv>) => options.now?.() ?? new Date(c.var.platform.now());

  const handle = async (c: Context<AppEnv>) => {
    const { platform } = c.var;
    const done = (outcome: Outcome, status: 200 | 400 | 404 | 413 | 429, fields = {}, extra = {}) => {
      log({ outcome, status, ...fields });
      return answer(status, extra);
    };
    const token = c.req.param("token") ?? "";
    if (!PUSH_TOKEN_RE.test(token)) return done("unknown_token", 404);

    const limiter = platform.rateLimiter("push");
    if (limiter && !(await limiter.limit(`push:${await hashToken(token)}`))) {
      return done("rate_limited", 429, {}, { "retry-after": String(RATE_LIMITERS.push.periodS) });
    }

    const pushes = new PushTokenStore(platform);
    const owner = await pushes.lookup(token);
    if (!owner) return done("unknown_token", 404);
    const { site, monitorId } = owner;
    const deps = backend(platform);
    const config = await getSiteConfig(deps.configs, site);
    const monitor = config
      ? monitorsOf(config).find((m) => m.id === monitorId && m.type === "push")
      : undefined;
    if (!monitor) return done("unknown_monitor", 404, { site, monitor: monitorId });
    if (!monitor.enabled) return done("paused", 404, { site, monitor: monitorId });

    let params: Params = pick((k) => c.req.query(k));
    if (c.req.method === "POST") {
      try {
        params = { ...params, ...(await bodyParams(c.req.raw)) };
      } catch (err) {
        if (!(err instanceof TooLarge)) throw err;
        return done("too_large", 413, { site, monitor: monitorId });
      }
    }
    const status = (params.status ?? "up").trim().toLowerCase() || "up";
    if (status !== "up" && status !== "down") return done("invalid", 400, { site, monitor: monitorId });

    const now = clock(c);
    const result: CheckResult = {
      monitorId,
      ts: isoSeconds(now),
      status,
      latencyMs: status === "up" ? pushLatency(params.ping) : null,
      message: pushMessage(params.msg, status),
    };
    await pushes.recordPush(site, monitorId, now.getTime());
    const out = await applyResults(
      deps,
      { site, runner: PUSH_RUNNER, runtime: platform.runtime },
      [result],
      now,
    );
    return done("ok", 200, {
      site,
      monitor: monitorId,
      result: status,
      accepted: out.accepted,
      opened: out.incidents.opened.length,
      resolved: out.incidents.resolved.length,
    });
  };

  app.get("/:token", handle);
  app.post("/:token", handle);
  return app;
}
