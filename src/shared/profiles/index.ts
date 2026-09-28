/**
 * The profile registry: the built-in profiles, registration of others, and which of them a site activates.
 * The view-model applies the active profiles in order; nothing else in Uptellis names a fact group or key.
 */
import type { SiteConfig } from "../config";
import { forgejoHa } from "./forgejo-ha";
import { generic } from "./generic";
import type { Profile } from "./types";
import { uptimeKuma } from "./uptime-kuma";

export type * from "./types";

/** The id format a site config accepts in `profiles`. */
const PROFILE_ID = /^[a-z][a-z0-9-]{0,31}$/;

const registry = new Map<string, Profile>([generic, forgejoHa, uptimeKuma].map((p) => [p.id, p]));

/** Every registered profile, built-ins first, in registration order (the admin panel lists them so). */
export const listProfiles = (): Profile[] => [...registry.values()];

/** Adds a profile (e.g. one kept outside this repo); its id must be new and valid in a site's `profiles`. */
export function registerProfile(profile: Profile): void {
  if (!PROFILE_ID.test(profile.id)) throw new Error(`Invalid profile id ${profile.id}`);
  if (registry.has(profile.id)) throw new Error(`Profile ${profile.id} is already registered`);
  registry.set(profile.id, profile);
}

/**
 * A site's active profiles, in order: `generic`, then `config.profiles` as listed (unknown ids skipped),
 * then `uptime-kuma` when the site has a Kuma source. Each profile appears once, at its first place.
 */
export function activeProfiles(config: Pick<SiteConfig, "profiles" | "sources">): Profile[] {
  const ids = [generic.id, ...config.profiles];
  if (config.sources.some((s) => s.kind === "kuma")) ids.push(uptimeKuma.id);
  const out: Profile[] = [];
  for (const id of ids) {
    const p = registry.get(id);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}
