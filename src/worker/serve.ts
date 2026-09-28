/**
 * The request path both entry points share (src/server.ts on Cloudflare, src/platform/docker/entry.ts in
 * Docker): the rate limits (./middleware/rate-limit.ts) run first, then the Hono API owns /api/*, /badge/*,
 * /embed/* and /embed.js (it resolves the principal and enforces permissions itself), and every other
 * request passes the page gate (./middleware/auth-gate.ts) and is server-rendered by TanStack Start. Every
 * answer that turns a request away is counted against the client's gate limit, and every response leaves
 * with the security headers (./middleware/security-headers.ts).
 *
 * While a page renders, loaders call the API in-process through `globalThis.__apiBridge`
 * (see src/client/lib/api.ts): same Hono app, same platform, no network hop. A bridged call carries the
 * page request's principal, so the read API judges it exactly as it would the page's own visitor.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import startHandler from "@tanstack/react-start/server-entry";
import type { Principal } from "@/shared/auth";
import type { AppBindings } from "./app-env";
import { accountsFor } from "./auth/context";
import { userCount } from "./auth/instance";
import { rememberPrincipal, resolvePrincipal } from "./auth/principal";
import { isWorkerOwned } from "./build";
import api from "./index";
import { pageGate } from "./middleware/auth-gate";
import { limitBeforeGates, limitGateRejection } from "./middleware/rate-limit";
import { withSecurityHeaders } from "./middleware/security-headers";

export interface RequestDeps {
  bindings: AppBindings;
}

type RequestScope = { bindings: AppBindings; request: Request; principal: Principal };
const scope = new AsyncLocalStorage<RequestScope>();

type Bridge = (path: string, init?: RequestInit) => Promise<Response>;
(globalThis as typeof globalThis & { __apiBridge?: Bridge }).__apiBridge = async (path, init) => {
  const s = scope.getStore();
  if (!s) throw new Error("API bridge used outside a request");
  const bridged = new Request(new URL(path, s.request.url), init);
  rememberPrincipal(bridged, s.principal);
  return api.fetch(bridged, s.bindings);
};

async function dispatch(request: Request, { bindings }: RequestDeps): Promise<Response> {
  const { platform } = bindings;
  const limited = await limitBeforeGates(request, platform);
  if (limited) return limited;

  const { pathname } = new URL(request.url);
  if (isWorkerOwned(pathname))
    return limitGateRejection(request, platform, await api.fetch(request, bindings));

  const accounts = accountsFor(platform, request.url);
  const principal = await resolvePrincipal(platform, accounts.auth, request);
  const gated = await pageGate(request, principal, async () => (await userCount(platform)) === 0);
  if (gated) return limitGateRejection(request, platform, gated);

  // Server functions read the default site from the request context (src/client/lib/page.ts).
  const siteDefault = platform.setting("SITE_DEFAULT");
  const res = await scope.run({ bindings, request, principal }, () =>
    startHandler.fetch(request, { responseLinkHeader: true, context: { siteDefault } }),
  );
  // Pages can be private: never cached at the edge or in the browser.
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "no-store");
  return limitGateRejection(request, platform, out);
}

/** One request through limits, gates, API or SSR, with the security headers on the way out. */
export async function handleRequest(request: Request, deps: RequestDeps): Promise<Response> {
  return withSecurityHeaders(await dispatch(request, deps), new URL(request.url).pathname);
}

// Types the request context passed to Start above (read in src/client/lib/page.ts). Declared here, not in
// src/client/router.tsx: there it would make the router type depend on itself.
declare module "@tanstack/react-router" {
  interface Register {
    server: { requestContext: { siteDefault: string | undefined } };
  }
}
