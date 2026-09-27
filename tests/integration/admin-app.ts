/**
 * The Worker as src/server.ts serves `/api/*` in production: admin gate, then viewer gate, then the Hono
 * app from src/worker/index.ts, over the migrated D1 and KV. The env adds an admin key and a master key
 * (random per run) to the test bindings of vitest.config.ts.
 */
import { env } from "cloudflare:test";
import { toBase64Url } from "@/worker/engine/seal";
import app from "@/worker/index";
import { adminGate } from "@/worker/middleware/admin-key";
import { viewerGate } from "@/worker/middleware/viewer-key";

export const ORIGIN = "https://worker.example.net";
export const ADMIN_KEY = "test-admin-key";

const masterKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));

export const adminEnv = {
  ...(env as unknown as Env),
  ADMIN_KEY,
  SOURCE_MASTER_KEY: masterKey,
} as Env;

/** One request through both gates and the app. */
export async function handle(path: string, init: RequestInit = {}, e: Env = adminEnv): Promise<Response> {
  const req = new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init });
  return (await adminGate(req, e)) ?? (await viewerGate(req, e)) ?? app.fetch(req, e);
}

/** The admin cookie (`name=value`) from `?admin=`. */
export async function adminCookie(): Promise<string> {
  const res = await handle(`/admin?admin=${ADMIN_KEY}`);
  if (res.status !== 302) throw new Error(`admin login: ${res.status}`);
  return (res.headers.get("set-cookie") ?? "").split(";")[0]!;
}

/** An admin client: GETs with the cookie, PUT/POST also same-origin, bodies as JSON unless a string. */
export function admin(cookie: string) {
  const send = (method: string, path: string, body?: unknown) =>
    handle(`/api/admin${path}`, {
      method,
      headers: {
        cookie,
        ...(method === "GET" ? {} : { origin: ORIGIN, "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  return {
    get: (path: string) => send("GET", path),
    put: (path: string, body: unknown) => send("PUT", path, body),
    post: (path: string, body?: unknown) => send("POST", path, body),
  };
}

/** A random base64url string, for secrets that must not appear as literals. */
export const randomToken = () => toBase64Url(crypto.getRandomValues(new Uint8Array(24)));

/** Response JSON, loosely typed for assertions. */
export const json = (r: Response): Promise<any> => r.json();
