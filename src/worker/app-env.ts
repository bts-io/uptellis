/**
 * The Hono env of the API. The entry points (src/server.ts on Cloudflare, src/platform/docker/entry.ts in
 * Docker) pass `AppBindings` to `app.fetch`; `platformContext` puts them on the context, and every handler
 * reads the runtime through `c.var.platform` only. The accounts middleware (src/worker/auth/context.ts) adds
 * the request's `principal` and `accounts` for every `/api/*` route but health.
 */
import type { MiddlewareHandler } from "hono";
import type { Platform } from "@/platform/types";
import type { Principal } from "@/shared/auth";
import type { Accounts } from "@/worker/auth/context";
import type { EnvIngestKeys } from "@/worker/ingest/keys";

export interface AppBindings {
  platform: Platform;
  /** The runtime's `INGEST_KEY_*` secrets (legacy env ingest keys, src/worker/ingest/keys.ts). */
  envIngestKeys: EnvIngestKeys;
}

export interface AppVariables {
  platform: Platform;
  envIngestKeys: EnvIngestKeys;
  principal: Principal;
  accounts: Accounts;
}

export type AppEnv = { Bindings: AppBindings; Variables: AppVariables };

/** Copies the request's bindings onto the context (`c.var.platform`, `c.var.envIngestKeys`). */
export const platformContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("platform", c.env.platform);
  c.set("envIngestKeys", c.env.envIngestKeys);
  await next();
};
