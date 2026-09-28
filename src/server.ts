/**
 * The Cloudflare Worker entry: every request goes through the shared path in src/worker/serve.ts (limits,
 * accounts and gates, the Hono API or TanStack Start, security headers) over a platform built from the Worker's
 * bindings (src/platform/cloudflare). `scheduled` maps each Cron Trigger to its job in `JOBS`
 * (src/platform/cloudflare/scheduled.ts). The Docker entry is src/platform/docker/entry.ts.
 */
import { createServerEntry } from "@tanstack/react-start/server-entry";
import { cloudflareBindings } from "./platform/cloudflare";
import { scheduled } from "./platform/cloudflare/scheduled";
import { warnLegacyKeys } from "./worker/auth/legacy";
import { handleRequest } from "./worker/serve";

const entry = createServerEntry({
  async fetch(request: Request, ...rest: unknown[]) {
    const [env, ctx] = rest as [Env, ExecutionContext];
    warnLegacyKeys((name) => (env as unknown as Record<string, string | undefined>)[name]);
    return handleRequest(request, { bindings: cloudflareBindings(env, ctx) });
  },
});

export default {
  fetch: entry.fetch,
  scheduled,
};
