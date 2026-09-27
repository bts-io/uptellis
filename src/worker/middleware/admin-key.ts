/**
 * Admin gate: guards `/admin`, `/admin/*` and `/api/admin/*` with `ADMIN_KEY`, the same way the viewer gate
 * guards the dashboard (./viewer-key.ts). src/server.ts runs it before the viewer gate.
 *
 * - `ADMIN_KEY` and `VIEWER_KEY` both unset (local dev): admin is open.
 * - `?admin=<ADMIN_KEY>` on a GET (any path): sets a signed `uptellis_admin` cookie for 30 days (SameSite=Lax: Strict would be withheld on the redirect after a link from another site, e.g. a README, and admin would 404; writes are guarded by the same-origin check)
 *   and redirects to the same URL without the key.
 * - Otherwise admin paths need a valid admin cookie and answer 404 without one, also when `ADMIN_KEY` is
 *   unset while `VIEWER_KEY` is set (production without an admin key has no admin).
 * - Mutating admin requests (anything but GET, HEAD, OPTIONS) must be same-origin: `Sec-Fetch-Site:
 *   same-origin`, or else an `Origin` equal to the request's; otherwise 403.
 *
 * A valid admin cookie also passes the viewer gate. The cookie is `<expiry>.<HMAC>` like the viewer cookie,
 * keyed with `VIEWER_COOKIE_SECRET` and `ADMIN_KEY` (`adminCookieSecret`), so rotating either revokes it.
 */
import {
  ADMIN_COOKIE,
  adminCookieSecret,
  constantTimeEqual,
  hasAdminCookie,
  notFound,
  signViewerCookie,
  VIEWER_COOKIE_MAX_AGE,
  type ViewerEnv,
} from "./viewer-key";

const ADMIN_PATH = /^\/(api\/)?admin(\/|$)/;
export const isAdminPath = (pathname: string) => ADMIN_PATH.test(pathname);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** True when a browser says the request comes from this origin (CSRF check for mutating requests). */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

/**
 * Returns a Response to send (redirect, 404 or 403), or null to hand the request on to the viewer gate.
 * Non-admin paths pass untouched unless they carry a matching `?admin=`.
 */
export async function adminGate(
  request: Request,
  env: ViewerEnv,
  nowMs = Date.now(),
): Promise<Response | null> {
  const url = new URL(request.url);
  const nowSec = Math.floor(nowMs / 1000);

  const key = url.searchParams.get("admin");
  if (
    key !== null &&
    env.ADMIN_KEY &&
    request.method === "GET" &&
    (await constantTimeEqual(key, env.ADMIN_KEY))
  ) {
    url.searchParams.delete("admin");
    const value = await signViewerCookie(adminCookieSecret(env), nowSec);
    return new Response(null, {
      status: 302,
      headers: {
        location: url.toString(),
        "set-cookie": `${ADMIN_COOKIE}=${value}; Max-Age=${VIEWER_COOKIE_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    });
  }

  if (!isAdminPath(url.pathname)) return null;
  const open = !env.ADMIN_KEY && !env.VIEWER_KEY;
  if (!open && !(await hasAdminCookie(request, env, nowSec))) return notFound(url.pathname);
  if (!SAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
    return Response.json(
      { error: "forbidden", message: "Cross-site request" },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  return null;
}
