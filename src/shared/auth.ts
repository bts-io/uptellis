/**
 * The auth contract (Phase 5, frozen): roles, permissions and who is asking. Better Auth provides accounts
 * and sessions; this file decides what each principal may do. Pure, shared by server and client.
 */
import { z } from "zod";

export const ROLES = ["owner", "admin", "viewer"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

/** A site's page is `public` (anyone) or `private` (signed-in users with a role). New sites are private. */
export const VISIBILITIES = ["public", "private"] as const;
export const Visibility = z.enum(VISIBILITIES);
export type Visibility = z.infer<typeof Visibility>;

export const PERMISSIONS = [
  "page.view", // see a site's page and read API
  "config.edit", // edit site config, restore revisions, import
  "sources.manage", // create sources, rotate ingest keys, manage API keys
  "users.manage", // invite users, change roles, remove users
  "instance.manage", // instance settings, OAuth providers, the owner-only danger zone
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
  admin: ["page.view", "config.edit", "sources.manage", "users.manage"],
  viewer: ["page.view"],
};

/** An API key is scoped to one site and a subset of what a pusher or agent may do. */
export const API_KEY_SCOPES = ["ingest", "read", "agent"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export type Principal =
  | { kind: "anonymous" }
  | { kind: "user"; userId: string; role: Role }
  | { kind: "apiKey"; keyId: string; site: string; scopes: readonly ApiKeyScope[] };

/** What a principal may do; `page.view` on a public site is allowed for everyone. */
export function can(
  principal: Principal,
  permission: Permission,
  site?: { slug: string; visibility: Visibility },
): boolean {
  if (permission === "page.view" && site?.visibility === "public") return true;
  switch (principal.kind) {
    case "anonymous":
      return false;
    case "user":
      return ROLE_PERMISSIONS[principal.role].includes(permission);
    case "apiKey":
      return permission === "page.view" && principal.scopes.includes("read") && site?.slug === principal.site;
  }
}
