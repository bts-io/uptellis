/**
 * Rate limits on the Workers Rate Limiting bindings (`ratelimits` in wrangler.jsonc). src/server.ts calls
 * `limitBeforeGates` before anything else and `limitGateRejection` on every answer that turned a request
 * away (401, 403 or 404).
 *
 * - Ingest (`POST /api/ingest/*`): per claimed key id and client IP, before the HMAC check. The IP keeps a
 *   request that only names a producer's key id from spending that producer's budget.
 * - Gate: per client IP, for sign-in attempts (`POST /api/auth/sign-in/*`, first-run setup, accepting an
 *   invite; counted before the password is checked, so guessing is slowed) and for requests turned away.
 * - Admin writes (any method but GET, HEAD, OPTIONS on an admin path): per client IP.
 *
 * Allowed page views, `/api/health` and everything else are never counted. A binding that is absent
 * (unit tests, a Worker built without the config) makes its limit a no-op.
 */
import { INGEST_HEADERS, KEY_ID_RE } from "@/shared/signing";
import { isAdminPath } from "./auth-gate";

/** The part of the Workers `RateLimit` binding used here, so unit tests can pass a fake. */
export interface Limiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export type RateLimitEnv = {
  INGEST_RATE_LIMIT?: Limiter;
  GATE_RATE_LIMIT?: Limiter;
  ADMIN_WRITE_RATE_LIMIT?: Limiter;
};

/** Every binding in wrangler.jsonc counts over 60 s, so a client told to wait this long gets a fresh window. */
export const RETRY_AFTER_S = 60;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const INGEST_PATH = /^\/api\/ingest\//;
/** Requests that try a credential: signing in, creating the owner, accepting an invite. */
const SIGN_IN_PATH = /^\/api\/(auth\/sign-in\/|setup$|invites\/[^/]+\/accept$)/;
const isSignInAttempt = (request: Request, pathname: string) =>
  request.method === "POST" && SIGN_IN_PATH.test(pathname);

/** The client address Cloudflare saw. Absent only outside Cloudflare (local tools), where all share one bucket. */
export const clientIp = (request: Request) => request.headers.get("cf-connecting-ip") ?? "unknown";

export function tooManyRequests(pathname: string): Response {
  const headers = { "cache-control": "no-store", "retry-after": String(RETRY_AFTER_S) };
  return pathname.startsWith("/api/")
    ? Response.json({ error: "rate_limited", message: "Too many requests" }, { status: 429, headers })
    : new Response("Too many requests", {
        status: 429,
        headers: { ...headers, "content-type": "text/plain" },
      });
}

/** True when `limiter` allows one more request for `key`; always true without a binding. */
async function allowed(limiter: Limiter | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  return (await limiter.limit({ key })).success;
}

/**
 * The 429 for a request over one of its limits, or null. Runs first, so a sign-in attempt is counted before
 * its credential is checked.
 */
export async function limitBeforeGates(request: Request, env: RateLimitEnv): Promise<Response | null> {
  const url = new URL(request.url);
  const ip = clientIp(request);

  if (request.method === "POST" && INGEST_PATH.test(url.pathname)) {
    const claimed = request.headers.get(INGEST_HEADERS.keyId) ?? "";
    // A malformed key id fails the HMAC check anyway; all of them share one name.
    const keyId = KEY_ID_RE.test(claimed) ? claimed : "-";
    return (await allowed(env.INGEST_RATE_LIMIT, `${keyId}|${ip}`)) ? null : tooManyRequests(url.pathname);
  }

  if (isSignInAttempt(request, url.pathname)) {
    if (!(await allowed(env.GATE_RATE_LIMIT, ip))) return tooManyRequests(url.pathname);
  }

  if (!SAFE_METHODS.has(request.method) && isAdminPath(url.pathname)) {
    if (!(await allowed(env.ADMIN_WRITE_RATE_LIMIT, ip))) return tooManyRequests(url.pathname);
  }
  return null;
}

/**
 * Counts a request that was turned away (401, 403 or 404) and answers 429 once the client IP is over its
 * limit; otherwise the response stands. Ingest keeps its own limit, and a sign-in attempt was counted
 * already by `limitBeforeGates`.
 */
export async function limitGateRejection(
  request: Request,
  env: RateLimitEnv,
  gated: Response,
): Promise<Response> {
  if (gated.status !== 401 && gated.status !== 403 && gated.status !== 404) return gated;
  const url = new URL(request.url);
  if (INGEST_PATH.test(url.pathname) || isSignInAttempt(request, url.pathname)) return gated;
  return (await allowed(env.GATE_RATE_LIMIT, clientIp(request))) ? gated : tooManyRequests(url.pathname);
}
