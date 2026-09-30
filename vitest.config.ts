import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Test-only secrets, never real values.
const bindings = async () => ({
  TEST_MIGRATIONS: await readD1Migrations("./migrations"),
  BETTER_AUTH_SECRET: "test-better-auth-secret-0123456789abcdef",
  // TEST_MASTER_KEY in tests/support/ingest-keys.ts: seals the test ingest keys seeded by the setup file.
  SOURCE_MASTER_KEY: btoa("uptellis-test-master-key-32bytes"),
});

// Three projects: pure unit tests in Node, the Hono API in workerd with a migrated D1, and the built Worker
// (vite build first, `bun run test` does that) for the gate and server-rendered documents.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    projects: [
      { extends: true, test: { name: "unit", include: ["tests/unit/**/*.test.ts"], environment: "node" } },
      {
        extends: true,
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            main: "./tests/integration/worker.ts",
            miniflare: { bindings: await bindings() },
          })),
        ],
        test: {
          name: "integration",
          // workerd + migrated D1 tests: CI and deploy run the suite at the same time on one runner, and
          // the heaviest cases took 6 to 7 s there, past the 5 s default.
          testTimeout: 20_000,
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/integration/setup.ts"],
        },
      },
      {
        extends: true,
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./dist/server/wrangler.json" },
            miniflare: { bindings: await bindings() },
          })),
        ],
        test: {
          name: "ssr",
          testTimeout: 20_000,
          include: ["tests/ssr/**/*.test.ts"],
          setupFiles: ["./tests/integration/setup.ts"],
        },
      },
    ],
  },
});
