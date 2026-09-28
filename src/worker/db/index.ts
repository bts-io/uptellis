import type { AppDb } from "@/platform/types";
import * as schema from "./schema";

/** Drizzle over the app's schema: D1 on Cloudflare, `bun:sqlite` in Docker (built by the platform adapters). */
export type Db = AppDb;
export { schema };
