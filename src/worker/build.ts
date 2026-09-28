/** The build id baked in by vite.config.ts, or "dev" where Vite never ran (integration tests, bare wrangler). */
export const buildId = () => (typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev");
/** The commit baked in at build time (first 12 hex of GITHUB_SHA in CI), "local" or "dev" otherwise. */
export const commitId = () => (typeof __COMMIT__ === "string" ? __COMMIT__ : "dev");

/** Paths the Hono app answers; everything else is a page rendered by TanStack Start. */
const WORKER_OWNED = /^\/(?:(?:api|badge|embed)(?:\/|$)|embed\.js$)/;
export const isWorkerOwned = (pathname: string) => WORKER_OWNED.test(pathname);
