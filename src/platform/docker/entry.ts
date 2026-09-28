/**
 * The Docker entry: the TanStack Start server entry of the Docker build (`bun run build:docker`, vite.config.ts
 * in `docker` mode), bundled with the whole app into `dist-docker/server/entry.js`. Its `fetch` takes the
 * request's `RequestDeps` from the Bun server (./server.ts), which `startDockerServer` starts; ./main.ts
 * calls it (the image's command). The Cloudflare entry is src/server.ts.
 */
import { fileURLToPath } from "node:url";
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { handleRequest, type RequestDeps } from "@/worker/serve";
import { startServer } from "./server";

const entry = createServerEntry({
  fetch: (request: Request, ...rest: unknown[]) => handleRequest(request, rest[0] as RequestDeps),
});

/** Start's `fetch` hands its extra arguments to the handler above; its type only names the first. */
const fetchWithDeps = entry.fetch as unknown as (request: Request, deps: RequestDeps) => Promise<Response>;

export default { fetch: entry.fetch };

/** Starts the server from `process.env`, and stops it gracefully on SIGTERM and SIGINT. */
export async function startDockerServer(): Promise<void> {
  const running = await startServer({
    env: process.env,
    handle: fetchWithDeps,
    clientDir: fileURLToPath(new URL("../client", import.meta.url)),
    migrationsFolder: fileURLToPath(new URL("../../migrations", import.meta.url)),
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      running.stop(signal).then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }
}
