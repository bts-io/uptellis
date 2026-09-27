/**
 * Viewer-key gate: the interim lock on the dashboard until Cloudflare Access fronts it (plan section 6).
 *
 * - `VIEWER_KEY` unset (local dev): everything is allowed.
 * - `?key=<VIEWER_KEY>` on a GET: sets a signed `uptellis_view` cookie for 30 days and redirects to the same URL
 *   without the key, so the key does not linger in the address bar, history or Referer.
 * - Otherwise a valid cookie is required; without one, pages and `/api/*` answer 404 (not 401/403, so the
 *   Worker does not advertise that something is here). Paths in `GATE_OPEN_PATHS` always pass.
 *
 * The cookie is `<expiry seconds>.<base64url HMAC-SHA256>` over `v1.<expiry>`. The HMAC key mixes
 * `VIEWER_COOKIE_SECRET` with `VIEWER_KEY`, so rotating either one revokes every issued cookie. A valid admin
 * cookie (`uptellis_admin`, same construction over `ADMIN_KEY`, see ./admin-key.ts) also lets a request through.
 * Pure WebCrypto: the same code runs in workerd and in the Node unit tests.
 */

export const VIEWER_COOKIE = "uptellis_view";
export const VIEWER_COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Paths that skip the gate. Health is for uptime checks; ingest carries its own HMAC auth (Phase 1).
 * Phase 4 decides whether the public surface (`/embed/*`, `/api/public/*`) joins this list.
 */
export const GATE_OPEN_PATHS: readonly RegExp[] = [/^\/api\/health$/, /^\/api\/ingest\//];

export type ViewerEnv = { VIEWER_KEY?: string; VIEWER_COOKIE_SECRET?: string; ADMIN_KEY?: string };

export const ADMIN_COOKIE = "uptellis_admin";

const enc = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** Equality that takes the same time wherever the inputs differ: both sides are hashed, then XOR-compared. */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

/** The HMAC secret for cookies, bound to the current viewer key. */
export function cookieSecret(env: ViewerEnv): string {
  const key = env.VIEWER_KEY ?? "";
  return env.VIEWER_COOKIE_SECRET ? `${env.VIEWER_COOKIE_SECRET}\n${key}` : key;
}

/**
 * The HMAC secret for the admin cookie, bound to the current admin key. The `admin` label keeps it apart
 * from the viewer secret even if both keys were set to the same value. Empty when `ADMIN_KEY` is unset.
 */
export function adminCookieSecret(env: ViewerEnv): string {
  return env.ADMIN_KEY ? `${env.VIEWER_COOKIE_SECRET ?? ""}\nadmin\n${env.ADMIN_KEY}` : "";
}

/** True when the request carries an unexpired admin cookie for the current `ADMIN_KEY`. */
export async function hasAdminCookie(request: Request, env: ViewerEnv, nowSec: number): Promise<boolean> {
  const cookie = readCookie(request.headers.get("cookie"), ADMIN_COOKIE);
  return verifyViewerCookie(cookie, adminCookieSecret(env), nowSec);
}

/** Cookie value valid until `nowSec + maxAge`. */
export async function signViewerCookie(
  secret: string,
  nowSec: number,
  maxAge = VIEWER_COOKIE_MAX_AGE,
): Promise<string> {
  const exp = Math.floor(nowSec) + maxAge;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(`v1.${exp}`));
  return `${exp}.${toBase64Url(sig)}`;
}

/** True only for an unexpired cookie signed with `secret`. `crypto.subtle.verify` compares in constant time. */
export async function verifyViewerCookie(
  value: string | null | undefined,
  secret: string,
  nowSec: number,
): Promise<boolean> {
  if (!value || !secret) return false;
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]+)$/.exec(value);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!Number.isSafeInteger(exp) || exp <= nowSec) return false;
  const sig = fromBase64Url(m[2]!);
  if (!sig) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret), sig, enc.encode(`v1.${exp}`));
}

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export const isOpenPath = (pathname: string) => GATE_OPEN_PATHS.some((re) => re.test(pathname));

export function notFound(pathname: string): Response {
  const headers = { "cache-control": "no-store" };
  return pathname.startsWith("/api/")
    ? Response.json({ error: "not_found", message: "Not found" }, { status: 404, headers })
    : new Response("Not found", { status: 404, headers: { ...headers, "content-type": "text/plain" } });
}

/**
 * Runs before both Hono and SSR. Returns a Response to send (redirect or 404), or null to let the request
 * through.
 */
export async function viewerGate(
  request: Request,
  env: ViewerEnv,
  nowMs = Date.now(),
): Promise<Response | null> {
  if (!env.VIEWER_KEY) return null;
  const url = new URL(request.url);
  if (isOpenPath(url.pathname)) return null;
  const nowSec = Math.floor(nowMs / 1000);
  const secret = cookieSecret(env);

  const key = url.searchParams.get("key");
  if (key !== null && request.method === "GET" && (await constantTimeEqual(key, env.VIEWER_KEY))) {
    url.searchParams.delete("key");
    const value = await signViewerCookie(secret, nowSec);
    return new Response(null, {
      status: 302,
      headers: {
        location: url.toString(),
        "set-cookie": `${VIEWER_COOKIE}=${value}; Max-Age=${VIEWER_COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }

  const cookie = readCookie(request.headers.get("cookie"), VIEWER_COOKIE);
  if (await verifyViewerCookie(cookie, secret, nowSec)) return null;
  if (await hasAdminCookie(request, env, nowSec)) return null;
  return notFound(url.pathname);
}
