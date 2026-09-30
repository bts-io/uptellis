/**
 * The Phase 1 write and read path as src/worker/index.ts mounts it (real ingest and read routes over
 * `appBackend`: D1Store + KvModelCache on the Cloudflare platform), with a settable clock, for integration tests in workerd. Requests
 * are signed with the shared `signRequest` and the test keys the setup file seeds into D1 (TEST_KEYS).
 */
import { Hono } from "hono";
import { randomNonce, signRequest } from "@/shared/signing";
import { type AppEnv, platformContext } from "@/worker/app-env";
import { appBackend } from "@/worker/index";
import { ingestRoutes } from "@/worker/ingest/routes";
import { readRoutes } from "@/worker/routes/read";
import { fetchWith, workerEnv } from "./platform";
import { TEST_KEYS } from "./signing";

export const ORIGIN = "https://worker.example.net";
export { workerEnv };

export type TestKeyId = "collector-1" | "facts-1";

export function pipeline(start: Date) {
  let now = start;
  const app = new Hono<AppEnv>().use(platformContext);
  app.route("/api/ingest", ingestRoutes(appBackend, { now: () => now }));
  app.route("/api/sites", readRoutes(appBackend, { now: () => now.getTime() }));

  /** A signed POST to `/api/ingest/<route>`, signed at the current test clock. */
  const signed = async (route: "kuma" | "facts" | "events", keyId: TestKeyId, payload: unknown) => {
    const path = `/api/ingest/${route}`;
    const body = JSON.stringify(payload);
    const headers = await signRequest(TEST_KEYS[keyId], keyId, "POST", path, body, now, randomNonce());
    return new Request(`${ORIGIN}${path}`, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", ...headers },
    });
  };

  return {
    signed,
    send: (req: Request) => fetchWith(app, req),
    get: (path: string) => fetchWith(app, new Request(`${ORIGIN}${path}`)),
    setNow: (d: Date) => {
      now = d;
    },
  };
}

/** Response JSON, loosely typed for assertions. */
export const json = (r: Response): Promise<any> => r.json();
