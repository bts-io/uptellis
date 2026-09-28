/**
 * What accounts need from the platform, read from the Worker env (D1 through Drizzle, secrets and vars).
 * Empty values count as unset.
 */
import type { SecretName, SettingName } from "@/platform/types";
import { createDb } from "../db";
import type { AuthPlatform } from "./instance";

export function envAuthPlatform(env: Env): AuthPlatform {
  const db = createDb(env.DB);
  const vars = env as unknown as Record<string, unknown>;
  const value = (name: SecretName | SettingName) => {
    const v = vars[name];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };
  return {
    db,
    batch: async (statements) => (await db.batch(statements)) as unknown[],
    secret: value,
    setting: value,
    now: Date.now,
  };
}
