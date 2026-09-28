/**
 * Single Worker entry: the rate limits (src/worker/middleware/rate-limit.ts) run first, then the Hono API
 * owns /api/* and /embed/* (it resolves the principal and enforces permissions itself), and every other
 * request passes the page gate (src/worker/middleware/auth-gate.ts) and is server-rendered by TanStack
 * Start. Every answer that turns a request away is counted against the client's gate limit, and every
 * response leaves with the security headers (src/worker/middleware/security-headers.ts).
 *
 * While a page renders, loaders call the API in-process through `globalThis.__apiBridge`
 * (see src/client/lib/api.ts): same Hono app, same env, no network hop. A bridged call carries the page
 * request's principal, so the read API judges it exactly as it would the page's own visitor.
 *
 * `scheduled` runs the cron jobs (every minute: edge probes; 5 min: downsample, staleness and the stale
 * cards; daily: prune).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import startHandler, { createServerEntry } from "@tanstack/react-start/server-entry";
import type { Principal } from "./shared/auth";
import { accountsFor } from "./worker/auth/context";
import { envAuthPlatform } from "./worker/auth/env-platform";
import { userCount } from "./worker/auth/instance";
import { warnLegacyKeys } from "./worker/auth/legacy";
import { rememberPrincipal, resolvePrincipal } from "./worker/auth/principal";
import { isWorkerOwned } from "./worker/build";
import worker from "./worker/index";
import { pageGate } from "./worker/middleware/auth-gate";
import { limitBeforeGates, limitGateRejection } from "./worker/middleware/rate-limit";
import { withSecurityHeaders } from "./worker/middleware/security-headers";
import { scheduled } from "./worker/scheduled";

type RequestScope = { env: Env; ctx: ExecutionContext; request: Request; principal: Principal };
const scope = new AsyncLocalStorage<RequestScope>();

type Bridge = (path: string, init?: RequestInit) => Promise<Response>;
(globalThis as typeof globalThis & { __apiBridge?: Bridge }).__apiBridge = async (path, init) => {
  const s = scope.getStore();
  if (!s) throw new Error("API bridge used outside a request");
  const bridged = new Request(new URL(path, s.request.url), init);
  rememberPrincipal(bridged, s.principal);
  return worker.fetch(bridged, s.env, s.ctx);
};

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  warnLegacyKeys((name) => (env as unknown as Record<string, string | undefined>)[name]);
  const limited = await limitBeforeGates(request, env);
  if (limited) return limited;

  const { pathname } = new URL(request.url);
  if (isWorkerOwned(pathname)) return limitGateRejection(request, env, await worker.fetch(request, env, ctx));

  const accounts = accountsFor(envAuthPlatform(env), request.url);
  const principal = await resolvePrincipal(accounts.platform, accounts.auth, request);
  const gated = await pageGate(request, principal, async () => (await userCount(accounts.platform)) === 0);
  if (gated) return limitGateRejection(request, env, gated);

  // Server functions read the default site from the request context (src/client/lib/page.ts).
  const res = await scope.run({ env, ctx, request, principal }, () =>
    startHandler.fetch(request, { responseLinkHeader: true, context: { siteDefault: env.SITE_DEFAULT } }),
  );
  // Pages can be private: never cached at the edge or in the browser.
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "no-store");
  return limitGateRejection(request, env, out);
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
