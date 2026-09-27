import { defineConfig } from "drizzle-kit";

// `bun run db:generate` only diffs the schema into ./migrations and needs no credentials. The d1-http
// credentials are read only by commands that talk to the remote database (drizzle-kit push / studio).
export default defineConfig({
  dialect: "sqlite",
  driver: "d1-http",
  casing: "snake_case",
  schema: "./src/worker/db/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
    databaseId: process.env.CLOUDFLARE_D1_ID ?? "",
    token: process.env.CLOUDFLARE_API_TOKEN ?? "",
  },
});
