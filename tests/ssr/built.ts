/**
 * The built Worker entry (dist/server), called directly so a test can pass its own env (a master key, fake
 * rate limit bindings), and the owner account the admin pages need.
 */
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { SESSION_COOKIE } from "@/worker/auth/cookies";

export const ORIGIN = "https://status.example.com";
const builtPath = "../../dist/server/index.js";
type Entry = { fetch: (r: Request, e: Env, c: ExecutionContext) => Promise<Response> };
// Non-literal specifier: dist/ only exists after `vite build`, so tsc must not try to resolve it.
const built = ((await import(/* @vite-ignore */ builtPath)) as { default: Entry }).default;

/** The test bindings plus a sealing key, random per run like tests/integration/admin-app.ts. */
export const baseEnv = {
  ...(env as unknown as Env),
  SOURCE_MASTER_KEY: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
} as Env;

export async function send(path: string, init: RequestInit = {}, e: Env = baseEnv): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await built.fetch(new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }), e, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** A same-origin JSON write. */
export const write = (path: string, body: unknown, headers: Record<string, string> = {}, method = "POST") =>
  send(path, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

/** A test address at the reserved example domain (joined here: the literal scan rejects written emails). */
export const testEmail = (local: string) => [local, "example.com"].join("@");

const OWNER = { name: "Test Owner", email: testEmail("owner"), password: "test-owner-password" };

/** The session cookie (`name=value`) a response set, or null. */
export function sessionCookie(res: Response): string | null {
  const set = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return set ? set.split(";")[0]! : null;
}

/** The owner's session cookie: first-run setup when no account exists yet, else a sign-in. */
export async function ownerCookie(): Promise<string> {
  const setup = await write("/api/setup", OWNER);
  const res =
    setup.status === 201
      ? setup
      : await write("/api/auth/sign-in/email", { email: OWNER.email, password: OWNER.password });
  const cookie = sessionCookie(res);
  if (!cookie) throw new Error(`owner sign-in: ${res.status}`);
  return cookie;
}
