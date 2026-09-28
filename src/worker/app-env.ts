import type { Platform } from "@/platform/types";

/** The Hono env of the API: every handler reads the runtime through `c.var.platform`. */
export type AppEnv = { Bindings: Env; Variables: { platform: Platform } };
