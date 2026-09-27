import { applyD1Migrations, type D1Migration, env } from "cloudflare:test";

// Test-only binding from vitest.config.ts; the pool types `env` as Cloudflare.Env.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

// No migrations yet in Phase 0; the storage stream's first one lands here without further wiring.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
