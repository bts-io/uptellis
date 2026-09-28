/**
 * The Cloudflare platform over the test bindings (migrated D1, KV, the rate limit bindings) for the
 * integration tests in workerd. Background work (`waitUntil`: cache warm-ups, Discord cards) is collected,
 * and `drain` waits for it, so a test sees it done once its request returned.
 */
import { env } from "cloudflare:test";
import type { Hono } from "hono";
import { createCloudflarePlatform } from "@/platform/cloudflare";
import type { Platform } from "@/platform/types";
import type { AppBindings, AppEnv } from "@/worker/app-env";
import { envIngestKeys } from "@/worker/ingest/keys";

export const workerEnv = env as unknown as Env;

export interface TestPlatform extends Platform {
  /** Waits for every `waitUntil` so far (and the work those started). */
  drain(): Promise<void>;
}

/** A platform over the test env, with `extra` env values (secrets, settings) layered on. */
export function testPlatform(extra: Partial<Env> = {}): TestPlatform {
  const pending: Promise<unknown>[] = [];
  const platform = createCloudflarePlatform({ ...workerEnv, ...extra } as Env, {
    waitUntil: (p) => void pending.push(p),
  });
  return {
    ...platform,
    drain: async () => {
      while (pending.length > 0) await Promise.allSettled(pending.splice(0));
    },
  };
}

/** The API bindings for one request, as src/platform/cloudflare builds them. */
export function testBindings(extra: Partial<Env> = {}): AppBindings & { platform: TestPlatform } {
  return { platform: testPlatform(extra), envIngestKeys: envIngestKeys({ ...workerEnv, ...extra }) };
}

/** `app.fetch` with fresh bindings; resolves after the request's background work settled. */
export async function fetchWith(
  app: Hono<AppEnv>,
  request: Request,
  extra: Partial<Env> = {},
): Promise<Response> {
  const bindings = testBindings(extra);
  const res = await app.fetch(request, bindings);
  await bindings.platform.drain();
  return res;
}
