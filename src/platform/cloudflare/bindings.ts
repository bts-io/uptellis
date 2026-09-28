import type { RateLimiterName } from "../types";

/** The Workers Rate Limiting binding behind each limiter (`ratelimits` in wrangler.jsonc). */
export const RATE_LIMIT_BINDINGS = {
  ingest: "INGEST_RATE_LIMIT",
  gate: "GATE_RATE_LIMIT",
  adminWrite: "ADMIN_WRITE_RATE_LIMIT",
} as const satisfies Record<RateLimiterName, string>;
