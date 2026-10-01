/**
 * Where things live in the admin: the four tabs of the top bar, the sub-sections of Settings, and where the
 * old admin URLs moved to. Each entry names the permission that opens it (the API checks it again on every
 * call); the shell shows only what the signed-in user's permissions open.
 */
import type { Permission } from "@/shared/auth";
import type { AdminIconName } from "./icons";

export interface AdminTab {
  to: "/admin" | "/admin/status-page" | "/admin/alerts" | "/admin/settings";
  label: string;
  icon: AdminIconName;
  /** Any one of these opens the tab. */
  needs: readonly Permission[];
  /** Active only on this exact path (Monitors is the home, every other page is below it). */
  exact: boolean;
}

export const ADMIN_TABS: readonly AdminTab[] = [
  { to: "/admin", label: "Monitors", icon: "monitors", needs: ["config.edit"], exact: true },
  {
    to: "/admin/status-page",
    label: "Status page",
    icon: "statusPage",
    needs: ["config.edit"],
    exact: false,
  },
  { to: "/admin/alerts", label: "Alerts", icon: "alerts", needs: ["config.edit"], exact: false },
  {
    to: "/admin/settings",
    label: "Settings",
    icon: "settings",
    needs: ["config.edit", "sources.manage", "users.manage"],
    exact: false,
  },
];

export interface SettingsSection {
  to:
    | "/admin/settings/sources"
    | "/admin/settings/users"
    | "/admin/settings/revisions"
    | "/admin/settings/import-export"
    | "/admin/settings/advanced";
  label: string;
  /** One line on the Settings page. */
  about: string;
  needs: Permission;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    to: "/admin/settings/sources",
    label: "Sources and keys",
    about: "Where outside data comes from, its keys, and API keys for this site.",
    needs: "sources.manage",
  },
  {
    to: "/admin/settings/users",
    label: "Users and invites",
    about: "Who can sign in, their roles, and open invites.",
    needs: "users.manage",
  },
  {
    to: "/admin/settings/revisions",
    label: "Revisions",
    about: "Every saved change, and going back to an earlier one.",
    needs: "config.edit",
  },
  {
    to: "/admin/settings/import-export",
    label: "Import and export",
    about: "Download the whole setup as one file, or load one.",
    needs: "config.edit",
  },
  {
    to: "/admin/settings/advanced",
    label: "Advanced",
    about: "Every setting in one form, or as JSON.",
    needs: "config.edit",
  },
];

/** Old admin pages and where they moved; each old route redirects there. */
export const LEGACY_ADMIN_REDIRECTS = {
  "/admin/sources": "/admin/settings/sources",
  "/admin/users": "/admin/settings/users",
  "/admin/revisions": "/admin/settings/revisions",
  "/admin/files": "/admin/settings/import-export",
  "/admin/themes": "/admin/status-page",
} as const;

export const allowed = (needs: Permission | readonly Permission[], permissions: readonly Permission[]) =>
  (typeof needs === "string" ? [needs] : needs).some((p) => permissions.includes(p));
