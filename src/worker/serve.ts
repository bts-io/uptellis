/**
 * The request path both entry points share (src/server.ts on Cloudflare, src/platform/docker/entry.ts in
 * Docker): the rate limits (./middleware/rate-limit.ts), the admin gate (`/admin`, `/api/admin/*`) and the
 * viewer-key gate run first, then the Hono API owns /api/* and /embed/*, and every other request is
 * server-rendered by TanStack Start. Every response leaves with the security headers
 * (./middleware/security-headers.ts).
 *
 * While a page renders, loaders call the API in-process through `globalThis.__apiBridge`
 * (see src/client/lib/api.ts): same Hono app, same platform, no network hop. The outer request already
 * passed the gate, so bridged calls are not gated again.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import startHandler from "@tanstack/react-start/server-entry";
import type { AppBindings } from "./app-env";
import { isWorkerOwned } from "./build";
import api from "./index";
import { adminGate } from "./middleware/admin-key";
import { limitBeforeGates, limitGateRejection } from "./middleware/rate-limit";
import { withSecurityHeaders } from "./middleware/security-headers";
import { type ViewerEnv, viewerGate } from "./middleware/viewer-key";

export interface RequestDeps {
  bindings: AppBindings;
  /** The viewer and admin keys the gates compare against. */
  gates: ViewerEnv;
}

type RequestScope = { bindings: AppBindings; request: Request };
const scope = new AsyncLocalStorage<RequestScope>();

type Bridge = (path: string, init?: RequestInit) => Promise<Response>;
(globalThis as typeof globalThis & { __apiBridge?: Bridge }).__apiBridge = async (path, init) => {
  const s = scope.getStore();
  if (!s) throw new Error("API bridge used outside a request");
  return api.fetch(new Request(new URL(path, s.request.url), init), s.bindings);
};

async function dispatch(request: Request, { bindings, gates }: RequestDeps): Promise<Response> {
  const { platform } = bindings;
  const limited = await limitBeforeGates(request, platform);
  if (limited) return limited;
  const gated = (await adminGate(request, gates)) ?? (await viewerGate(request, gates));
  if (gated) return limitGateRejection(request, platform, gated);

  const { pathname } = new URL(request.url);
  if (isWorkerOwned(pathname)) return api.fetch(request, bindings);

  // Server functions read the default site from the request context (src/client/lib/page.ts).
  const siteDefault = platform.setting("SITE_DEFAULT");
  const res = await scope.run({ bindings, request }, () =>
    startHandler.fetch(request, { responseLinkHeader: true, context: { siteDefault } }),
  );
  // A private dashboard: never cached at the edge or in the browser.
  const out = new Response(res.body, res);
  out.headers.set("cache-control", "no-store");
  return out;
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
