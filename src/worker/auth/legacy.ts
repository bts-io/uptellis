/**
 * The interim key gates are gone: an install that still has their secrets set is told, once per process
 * (isolate), to create the owner account at `/setup` and delete them.
 */
import { AUTH_PAGES } from "@/shared/schemas/auth";

export const LEGACY_SECRETS = ["VIEWER_KEY", "VIEWER_COOKIE_SECRET", "ADMIN_KEY"] as const;

let told = false;

/** Logs the notice when any legacy secret is set; `value` reads one by name (env, process env). */
export function warnLegacyKeys(value: (name: string) => string | undefined): void {
  if (told) return;
  told = true;
  const set = LEGACY_SECRETS.filter((name) => Boolean(value(name)));
  if (set.length === 0) return;
  console.warn(
    JSON.stringify({
      evt: "legacy_keys",
      set,
      message: `${set.join(", ")} ${set.length === 1 ? "is" : "are"} no longer used: open ${AUTH_PAGES.setup} to create the owner account, then remove ${set.length === 1 ? "it" : "them"}`,
    }),
  );
}
