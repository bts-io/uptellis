/**
 * Who is asking: a signed-in user (Better Auth session cookie), an API key (`Authorization: Bearer
 * upt_...`) or nobody. src/server.ts resolves the principal once per request and remembers it for the
 * in-process API bridge, so a page's loader calls are judged as the page request was; the Hono middleware
 * (./context.ts) resolves it for requests that did not come through there.
 *
 * Cheap for anonymous traffic: without a session cookie or a bearer token nothing touches the database.
 */
import type { Principal, Role } from "@/shared/auth";
import { ROLES } from "@/shared/auth";
import { bearerToken, verifyApiKey } from "./api-keys";
import { SESSION_COOKIE } from "./cookies";
import type { Auth, AuthPlatform } from "./instance";

export const ANONYMOUS: Principal = { kind: "anonymous" };

const remembered = new WeakMap<Request, Principal>();

/** Remembers the principal of `request` (the outer request, or a bridged one made on its behalf). */
export function rememberPrincipal(request: Request, principal: Principal): void {
  remembered.set(request, principal);
}

export const rememberedPrincipal = (request: Request): Principal | undefined => remembered.get(request);

/** True when the request carries the session cookie. */
export function hasSessionCookie(request: Request): boolean {
  const header = request.headers.get("cookie");
  if (!header) return false;
  return header.split(";").some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
}

const isRole = (v: unknown): v is Role => typeof v === "string" && (ROLES as readonly string[]).includes(v);

/** The session's user as a principal, or anonymous. */
export async function sessionPrincipal(auth: Auth | null, request: Request): Promise<Principal> {
  if (!auth || !hasSessionCookie(request)) return ANONYMOUS;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || !isRole(session.user.role)) return ANONYMOUS;
  return { kind: "user", userId: session.user.id, role: session.user.role };
}

/**
 * The request's principal. A bearer token that is not a valid, unrevoked API key makes the request
 * anonymous (a public page still answers; everything else refuses).
 */
export async function resolvePrincipal(
  p: AuthPlatform,
  auth: () => Auth | null,
  request: Request,
): Promise<Principal> {
  const known = remembered.get(request);
  if (known) return known;
  const token = bearerToken(request);
  if (token !== null) {
    const key = await verifyApiKey(p, token);
    return key ? { kind: "apiKey", keyId: key.id, site: key.site, scopes: key.scopes } : ANONYMOUS;
  }
  return sessionPrincipal(auth(), request);
}
