/**
 * The page gate: what src/server.ts checks before TanStack Start renders a page. The API enforces its own
 * permissions in the Hono app (src/worker/auth/context.ts, src/worker/routes), and a site page is judged by
 * the read API its loader calls through the bridge (a private site the principal may not view answers 404,
 * so its page does too). What is left for this gate is the admin UI:
 *
 * - `/admin` and `/admin/*` need a signed-in user with one of the admin permissions (`config.edit`,
 *   `sources.manage`, `users.manage`). Signed out: a redirect to `/sign-in?next=<path>` (to `/setup` while
 *   no account exists). Signed in without them, or with an API key: 404.
 * - Everything else passes (the account pages `/setup`, `/sign-in`, `/invite/<token>` and the site pages).
 */
import { can, type Principal } from "@/shared/auth";
import { AUTH_PAGES } from "@/shared/schemas/auth";

const ADMIN_PATH = /^\/(api\/)?admin(\/|$)/;
/** `/admin`, `/admin/*` and `/api/admin/*`. */
export const isAdminPath = (pathname: string) => ADMIN_PATH.test(pathname);

const ADMIN_PERMISSIONS = ["config.edit", "sources.manage", "users.manage"] as const;

export function notFound(pathname: string): Response {
  const headers = { "cache-control": "no-store" };
  return pathname.startsWith("/api/")
    ? Response.json({ error: "not_found", message: "Not found" }, { status: 404, headers })
    : new Response("Not found", { status: 404, headers: { ...headers, "content-type": "text/plain" } });
}

const redirect = (location: string) =>
  new Response(null, { status: 302, headers: { location, "cache-control": "no-store" } });

/**
 * A Response for a page request the principal may not see (redirect or 404), or null to render it.
 * `setupNeeded` is asked only for a signed-out request to the admin UI.
 */
export async function pageGate(
  request: Request,
  principal: Principal,
  setupNeeded: () => Promise<boolean>,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!isAdminPath(url.pathname)) return null;
  if (principal.kind === "anonymous") {
    if (await setupNeeded()) return redirect(AUTH_PAGES.setup);
    return redirect(`${AUTH_PAGES.signIn}?next=${encodeURIComponent(url.pathname + url.search)}`);
  }
  return ADMIN_PERMISSIONS.some((p) => can(principal, p)) ? null : notFound(url.pathname);
}
