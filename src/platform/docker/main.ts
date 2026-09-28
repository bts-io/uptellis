/**
 * Starts the Docker server from the Docker build (`bun run build:docker` writes dist-docker/). A separate
 * file because Bun serves the default export of the main module by itself when it has a `fetch`, which
 * the Start server entry (./entry.ts) must have.
 */
const built = new URL("../../../dist-docker/server/entry.js", import.meta.url);
const { startDockerServer } = (await import(built.href)) as typeof import("./entry");
await startDockerServer();
