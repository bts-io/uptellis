/**
 * The Worker as src/worker/serve.ts serves `/api/*` in production: the Hono app from src/worker/index.ts
 * (it resolves the principal and enforces permissions itself) over the Cloudflare platform (migrated D1 and
 * KV), with the test bindings of vitest.config.ts (its master key seals the seeded test ingest keys).
 * `adminCookie` signs in as the owner, creating it on first use.
 */
import { SESSION_COOKIE } from "@/worker/auth/cookies";
import { toBase64Url } from "@/worker/engine/seal";
import app from "@/worker/index";
import { fetchWith, workerEnv } from "../support/platform";

export const ORIGIN = "https://worker.example.net";

export const adminEnv = { ...workerEnv } as Env;

/** A test address at the reserved example domain (joined here: the literal scan rejects written emails). */
export const testEmail = (local: string) => [local, "example.com"].join("@");

/** Test-only credentials. */
export const OWNER = { name: "Test Owner", email: testEmail("owner"), password: "test-owner-password" };

/** One request through the app. */
export async function handle(path: string, init: RequestInit = {}, e: Env = adminEnv): Promise<Response> {
  return fetchWith(app, new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }), e);
}

/** A same-origin JSON POST (or another method). */
export const send = (path: string, body: unknown, init: RequestInit = {}, method = "POST") =>
  handle(path, {
    method,
    ...init,
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      ...(init.headers as Record<string, string>),
    },
    body: JSON.stringify(body),
  });

/** The session cookie (`name=value`) a response set, or null. */
export function sessionCookie(res: Response): string | null {
  const set = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return set ? set.split(";")[0]! : null;
}

/** Signs in with email and password; the session cookie, or null when refused. */
export async function signIn(email: string, password: string): Promise<string | null> {
  const res = await send("/api/auth/sign-in/email", { email, password });
  return res.ok ? sessionCookie(res) : null;
}

/** The owner's session cookie: first-run setup when no account exists yet, else a sign-in. */
export async function adminCookie(): Promise<string> {
  const setup = await send("/api/setup", OWNER);
  const cookie = setup.status === 201 ? sessionCookie(setup) : await signIn(OWNER.email, OWNER.password);
  if (!cookie) throw new Error(`owner sign-in: ${setup.status}`);
  return cookie;
}

/** An admin client: GETs with the cookie, writes also same-origin, bodies as JSON unless a string. */
export function admin(cookie: string) {
  const call = (method: string, path: string, body?: unknown) =>
    handle(`/api/admin${path}`, {
      method,
      headers: {
        cookie,
        ...(method === "GET" ? {} : { origin: ORIGIN, "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  return {
    get: (path: string) => call("GET", path),
    put: (path: string, body: unknown) => call("PUT", path, body),
    post: (path: string, body?: unknown) => call("POST", path, body),
    patch: (path: string, body: unknown) => call("PATCH", path, body),
    delete: (path: string) => call("DELETE", path),
  };
}

/** A random base64url string, for secrets that must not appear as literals. */
export const randomToken = () => toBase64Url(crypto.getRandomValues(new Uint8Array(24)));

/** Response JSON, loosely typed for assertions. */
export const json = (r: Response): Promise<any> => r.json();
