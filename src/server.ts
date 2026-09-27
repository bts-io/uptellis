/**
 * Single Worker entry: the rate limits (src/worker/middleware/rate-limit.ts), the admin gate (`/admin`,
 * `/api/admin/*`) and the viewer-key gate run first, then the Hono API owns /api/* and /embed/*, and every
 * other request is server-rendered by TanStack Start.
 * Every response leaves with the security headers (src/worker/middleware/security-headers.ts).
 *
 * While a page renders, loaders call the API in-process through `globalThis.__apiBridge`
 * (see src/client/lib/api.ts): same Hono app, same env, no network hop. The outer request already passed
 * the gate, so bridged calls are not gated again.
 *
 * `scheduled` runs the cron jobs (every minute: edge probes; 5 min: downsample, staleness and the stale
 * cards; daily: prune).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import startHandler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { isWorkerOwned } from "./worker/build";
import worker from "./worker/index";
import { adminGate } from "./worker/middleware/admin-key";
import { limitBeforeGates, limitGateRejection } from "./worker/middleware/rate-limit";
import { withSecurityHeaders } from "./worker/middleware/security-headers";
import { viewerGate } from "./worker/middleware/viewer-key";
import { scheduled } from "./worker/scheduled";

type RequestScope = { env: Env; ctx: ExecutionContext; request: Request };
const scope = new AsyncLocalStorage<RequestScope>();

type Bridge = (path: string, init?: RequestInit) => Promise<Response>;
(globalThis as typeof globalThis & { __apiBridge?: Bridge }).__apiBridge = async (path, init) => {
  const s = scope.getStore();
  if (!s) throw new Error("API bridge used outside a request");
  return worker.fetch(new Request(new URL(path, s.request.url), init), s.env, s.ctx);
};

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const limited = await limitBeforeGates(request, env);
  if (limited) return limited;
  const gated = (await adminGate(request, env)) ?? (await viewerGate(request, env));
  if (gated) return limitGateRejection(request, env, gated);

  const { pathname } = new URL(request.url);
  if (isWorkerOwned(pathname)) return worker.fetch(request, env, ctx);

  // Server functions read the default site from the request context (src/client/lib/page.ts).
  const res = await scope.run({ env, ctx, request }, () =>
    startHandler.fetch(request, { responseLinkHeader: true, context: { siteDefault: env.SITE_DEFAULT } }),
  );
  // A private dashboard: never cached at the edge or in the browser.
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "no-store");
  return out;
}

const entry = createServerEntry({
  async fetch(request: Request, ...rest: unknown[]) {
    const [env, ctx] = rest as [Env, ExecutionContext];
    return withSecurityHeaders(await handle(request, env, ctx), new URL(request.url).pathname);
  },
});

// Types the request context passed to Start above (read in src/client/lib/page.ts). Declared here, not in
// src/client/router.tsx: there it would make the router type depend on itself.
declare module "@tanstack/react-router" {
  interface Register {
    server: { requestContext: { siteDefault: string } };
  }
}

export default {
  fetch: entry.fetch,
  scheduled,
};
