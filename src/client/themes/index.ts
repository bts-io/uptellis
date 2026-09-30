/**
 * Theme registry. A site's `theme` picks its entry; an id that is unknown or not registered yet falls back
 * to theme A, so a config never renders a blank page. Each theme folder exports its `ThemeModule`
 * (`aSysStatus`, `bControlRoom`, `cSession`) and a `THEME_COLOR` (its `--color-base`), registered here.
 */
import type { ThemeId } from "@/shared/config";
import { aSysStatus } from "./a-sys-status";
import { THEME_COLOR as B_THEME_COLOR, bControlRoom } from "./b-control-room";
import { THEME_COLOR as C_THEME_COLOR, cSession } from "./c-session";
import { THEME_COLOR as D_THEME_COLOR, dClassic } from "./d-classic";
import { THEME_COLOR as I_THEME_COLOR, iMinimal } from "./i-minimal";
import { THEME_COLOR as E_THEME_COLOR, eEditorial } from "./e-editorial";
import { THEME_COLOR as H_THEME_COLOR, hFriendly } from "./h-friendly";
import { THEME_COLOR as F_THEME_COLOR, fDashboard } from "./f-dashboard";
import { THEME_COLOR as G_THEME_COLOR, gWallboard } from "./g-wallboard";
import type { ThemeModule } from "./types";

export interface RegisteredTheme {
  module: ThemeModule;
  /** `<meta name="theme-color">`: the theme's page background (`--color-base`). */
  themeColor: string;
}

export const THEMES: Partial<Record<ThemeId, RegisteredTheme>> = {
  "a-sys-status": { module: aSysStatus, themeColor: "#1d1d27" },
  "b-control-room": { module: bControlRoom, themeColor: B_THEME_COLOR },
  "c-session": { module: cSession, themeColor: C_THEME_COLOR },
  "d-classic": { module: dClassic, themeColor: D_THEME_COLOR },
  "i-minimal": { module: iMinimal, themeColor: I_THEME_COLOR },
  "e-editorial": { module: eEditorial, themeColor: E_THEME_COLOR },
  "h-friendly": { module: hFriendly, themeColor: H_THEME_COLOR },
  "f-dashboard": { module: fDashboard, themeColor: F_THEME_COLOR },
  "g-wallboard": { module: gWallboard, themeColor: G_THEME_COLOR },
};

export const DEFAULT_THEME: RegisteredTheme = THEMES["a-sys-status"]!;

export function themeFor(id: string | null | undefined): RegisteredTheme {
  return (id && Object.hasOwn(THEMES, id) ? THEMES[id as ThemeId] : undefined) ?? DEFAULT_THEME;
}

/** True when `id` names a registered theme (the `?theme=` preview and the admin theme select accept only these). */
export function isRegisteredTheme(id: unknown): id is ThemeId {
  return typeof id === "string" && Object.hasOwn(THEMES, id);
}

/** Registered themes in registry order, for pickers and previews. */
export function registeredThemes(): RegisteredTheme[] {
  return Object.values(THEMES).filter((t): t is RegisteredTheme => t !== undefined);
}
