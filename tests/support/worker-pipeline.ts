/**
 * The Phase 1 write and read path as src/worker/index.ts mounts it (real ingest and read routes over
 * `d1Backend`: D1Store + KvModelCache), with a settable clock, for integration tests in workerd. Requests
 * are signed with the shared `signRequest` and the test secrets bound in vitest.config.ts.
 */
import { env } from "cloudflare:test";
import { Hono } from "hono";
import { randomNonce, signRequest } from "@/shared/signing";
import { d1Backend } from "@/worker/index";
import { ingestRoutes } from "@/worker/ingest/routes";
import { readRoutes } from "@/worker/routes/read";

export const ORIGIN = "https://worker.example.net";
export const workerEnv = env as unknown as Env;

const SECRETS = {
  "collector-1": () => workerEnv.INGEST_KEY_COLLECTOR_1,
  "facts-1": () => workerEnv.INGEST_KEY_FACTS_1,
};
export type TestKeyId = keyof typeof SECRETS;

export function pipeline(start: Date) {
  let now = start;
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/ingest", ingestRoutes<Env>(d1Backend, { now: () => now }));
  app.route("/api/sites", readRoutes(d1Backend, { now: () => now.getTime() }));

  /** A signed POST to `/api/ingest/<route>`, signed at the current test clock. */
  const signed = async (route: "kuma" | "facts" | "events", keyId: TestKeyId, payload: unknown) => {
    const path = `/api/ingest/${route}`;
    const body = JSON.stringify(payload);
    const headers = await signRequest(SECRETS[keyId](), keyId, "POST", path, body, now, randomNonce());
    return new Request(`${ORIGIN}${path}`, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...headers },
    });
  };

  return {
    signed,
    send: (req: Request) => app.fetch(req, workerEnv),
    get: (path: string) => app.fetch(new Request(`${ORIGIN}${path}`), workerEnv),
    setNow: (d: Date) => {
      now = d;
    },
  };
}

/** Response JSON, loosely typed for assertions. */
export const json = (r: Response): Promise<any> => r.json();
