/**
 * Accounts in the Hono app: a middleware puts the request's `principal` and its `accounts` (the platform,
 * the base URL and a lazily built Better Auth) on the context, and `requirePermission` guards the admin API
 * with `can()` from src/shared/auth.ts: 401 when signed out, 403 when signed in without the permission.
 * A route that never ran the middleware sees an anonymous principal.
 */
import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { can, type Permission, type Principal } from "@/shared/auth";
import type { AuthErrorResponse } from "@/shared/schemas/auth";
import { type Auth, type AuthPlatform, baseUrl, createAuth } from "./instance";
import { ANONYMOUS, resolvePrincipal } from "./principal";

export interface Accounts {
  platform: AuthPlatform;
  /** The instance's public origin (`PUBLIC_URL`, else the request's). */
  baseUrl: string;
  /** Better Auth for this request, built on first use; null without `BETTER_AUTH_SECRET`. */
  auth(): Auth | null;
}

export type AuthVariables = { principal: Principal; accounts: Accounts };
export type AuthEnv = { Bindings: Env; Variables: AuthVariables };

export function accountsFor(platform: AuthPlatform, requestUrl: string): Accounts {
  let auth: Auth | null | undefined;
  return {
    platform,
    baseUrl: baseUrl(platform, requestUrl),
    auth: () => {
      if (auth === undefined) auth = createAuth(platform, requestUrl);
      return auth;
    },
  };
}

/** Sets `accounts` and `principal` for every request below it. */
export function withPrincipal(platformOf: (c: Context<AuthEnv>) => AuthPlatform): MiddlewareHandler<AuthEnv> {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const accounts = accountsFor(platformOf(c), c.req.url);
    c.set("accounts", accounts);
    c.set("principal", await resolvePrincipal(accounts.platform, accounts.auth, c.req.raw));
    await next();
  });
}

/** The request's principal (anonymous when the middleware did not run). */
export const principalOf = (c: Context): Principal =>
  (c.get("principal") as Principal | undefined) ?? ANONYMOUS;

/** The request's accounts (undefined when the middleware did not run). */
export const accountsOf = (c: Context): Accounts | undefined => c.get("accounts") as Accounts | undefined;

export const authError = (
  c: Context,
  status: 400 | 401 | 403 | 404 | 409 | 503,
  error: AuthErrorResponse["error"],
  message: string,
  issues: AuthErrorResponse["issues"] = [],
) => c.json({ error, message, issues } satisfies AuthErrorResponse, status, { "cache-control": "no-store" });

/** 401 JSON when signed out, 403 when the principal lacks `permission`. */
export function requirePermission(permission: Permission): MiddlewareHandler<AuthEnv> {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const principal = principalOf(c);
    if (principal.kind === "anonymous") return authError(c, 401, "unauthorized", "Sign in first");
    if (!can(principal, permission)) return authError(c, 403, "forbidden", "Not allowed");
    await next();
  });
}
