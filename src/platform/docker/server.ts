/**
 * The Docker server: one Bun process serving the built client files (./static.ts), the Hono API and the
 * TanStack Start pages (through the request path in src/worker/serve.ts), and running `JOBS` on its own
 * scheduler (./scheduler.ts), over the SQLite platform (./index.ts). It listens on `PORT` (default 3000)
 * and on SIGTERM or SIGINT stops taking requests, lets running requests and jobs finish, waits for
 * background work, then closes the database.
 *
 * Env: `PORT`, `DATABASE_PATH` (default `./data/uptellis.db`; the image sets `/data/uptellis.db`),
 * `TRUST_PROXY` (`1` behind a reverse proxy: the client address is the last `X-Forwarded-For` hop), the
 * platform's secrets and settings, and `INGEST_KEY_*`; each may be given as `<NAME>_FILE` (./env.ts).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { JOBS } from "@/platform/types";
import { warnLegacyKeys } from "@/worker/auth/legacy";
import { envIngestKeys } from "@/worker/ingest/keys";
import { runScheduledJob } from "@/worker/scheduled";
import type { RequestDeps } from "@/worker/serve";
import { type EnvSource, readEnv, readEnvMatching } from "./env";
import { createDockerPlatform } from "./index";
import { startScheduler } from "./scheduler";
import { serveStatic } from "./static";

export interface ServerOptions {
  env: EnvSource;
  /** The app's request handler (the Start server entry's `fetch`, which runs `handleRequest`). */
  handle: (request: Request, deps: RequestDeps) => Promise<Response>;
  /** The built client files (`dist-docker/client`). */
  clientDir: string;
  /** The Drizzle migrations (`migrations/`). */
  migrationsFolder: string;
}

export const DEFAULT_PORT = 3000;
export const DEFAULT_DATABASE_PATH = "./data/uptellis.db";

const log = (fields: Record<string, string | number>) =>
  console.log(JSON.stringify({ evt: "server", ...fields }));

/** The client address from the socket, or from the last `X-Forwarded-For` hop behind a trusted proxy. */
function clientAddress(request: Request, socket: string | undefined, trustProxy: boolean): string {
  if (trustProxy) {
    const hops = (request.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim());
    const last = hops.filter(Boolean).at(-1);
    if (last) return last;
  }
  return socket ?? "unknown";
}

export async function startServer(opts: ServerOptions) {
  const { env } = opts;
  const databasePath = readEnv(env, "DATABASE_PATH") ?? DEFAULT_DATABASE_PATH;
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  const platform = createDockerPlatform({ databasePath, migrationsFolder: opts.migrationsFolder, env });
  warnLegacyKeys((name) => readEnv(env, name));
  const deps: RequestDeps = {
    bindings: { platform, envIngestKeys: envIngestKeys(readEnvMatching(env, /^INGEST_KEY_[A-Z0-9_]+$/)) },
  };
  const trustProxy = readEnv(env, "TRUST_PROXY") === "1";
  const port = Number(readEnv(env, "PORT") ?? DEFAULT_PORT);

  const server = Bun.serve({
    port,
    async fetch(request, srv) {
      const file = await serveStatic(request, opts.clientDir);
      if (file) return file;
      // The rate limits key on this header (src/worker/middleware/rate-limit.ts); a client's own is replaced.
      const headers = new Headers(request.headers);
      headers.set("cf-connecting-ip", clientAddress(request, srv.requestIP(request)?.address, trustProxy));
      return opts.handle(new Request(request, { headers }), deps);
    },
    error(err) {
      console.error(JSON.stringify({ evt: "error", name: err.name }));
      return Response.json({ error: "internal", message: "Something went wrong" }, { status: 500 });
    },
  });
  const scheduler = startScheduler((job, scheduledTime) => runScheduledJob(platform, job, scheduledTime));
  log({ step: "listening", port: server.port ?? port, jobs: Object.keys(JOBS).length });

  let stopping: Promise<void> | null = null;
  const stop = (signal: string) => {
    stopping ??= (async () => {
      log({ step: "stopping", signal });
      await server.stop();
      await scheduler.stop();
      await platform.drain();
      platform.close();
      log({ step: "stopped" });
    })();
    return stopping;
  };
  return { server, platform, scheduler, stop };
}
