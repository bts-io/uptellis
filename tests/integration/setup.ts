import { applyD1Migrations, type D1Migration, env } from "cloudflare:test";
import { seedTestKeys } from "../support/ingest-keys";
import { testPlatform } from "../support/platform";

// Test-only binding from vitest.config.ts; the pool types `env` as Cloudflare.Env.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
// Ingest keys live in D1 only: the demo site's test keys (TEST_KEYS), sealed under the test master key.
await seedTestKeys(testPlatform());
