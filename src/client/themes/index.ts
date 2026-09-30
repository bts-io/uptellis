/**
 * Theme registry. A site's `theme` picks its entry; an id that is unknown or not registered yet falls back
 * to theme A, so a config never renders a blank page. Each theme folder exports its `ThemeModule`
 * (`aSysStatus`, `bControlRoom`, `cSession`...) and a `THEME_COLOR` (its `--color-base`); the Phase 7 themes
 * also export `FONTS` (the font files they preload) and, when they follow `prefers-color-scheme`, a
 * `THEME_COLOR_DARK`. All are registered here.
 */
import type { ThemeId } from "@/shared/config";
import { aSysStatus } from "./a-sys-status";
import { THEME_COLOR as B_THEME_COLOR, bControlRoom } from "./b-control-room";
import { THEME_COLOR as C_THEME_COLOR, cSession } from "./c-session";
import { FONTS as D_FONTS, THEME_COLOR as D_THEME_COLOR, dClassic } from "./d-classic";
import { FONTS as E_FONTS, THEME_COLOR as E_THEME_COLOR, eEditorial } from "./e-editorial";
import {
  FONTS as F_FONTS,
  THEME_COLOR as F_THEME_COLOR,
  THEME_COLOR_DARK as F_THEME_COLOR_DARK,
  fDashboard,
} from "./f-dashboard";
import { FONTS as G_FONTS, THEME_COLOR as G_THEME_COLOR, gWallboard } from "./g-wallboard";
import { FONTS as H_FONTS, THEME_COLOR as H_THEME_COLOR, hFriendly } from "./h-friendly";
import {
  FONTS as I_FONTS,
  THEME_COLOR as I_THEME_COLOR,
  THEME_COLOR_DARK as I_THEME_COLOR_DARK,
  iMinimal,
} from "./i-minimal";
import type { ThemeModule } from "./types";

export interface RegisteredTheme {
  module: ThemeModule;
  /** `<meta name="theme-color">`: the theme's page background (`--color-base`). */
  themeColor: string;
  /**
   * The dark `--color-base` of a theme that follows `prefers-color-scheme`. When set, the head sends two
   * `theme-color` tags, `themeColor` for light and this for dark (`themeHead` below).
   */
  themeColorDark?: string;
  /** Font files (under /fonts) the head preloads while this theme is shown; empty for a system font stack. */
  fonts: readonly string[];
}

/** The kit's default fonts (styles.css): Geist and JetBrains Mono, used by themes A, B and C. */
export const KIT_FONTS: readonly string[] = [
  "/fonts/Geist-Variable.woff2",
  "/fonts/JetBrainsMono-Variable.woff2",
];

export const THEMES: Partial<Record<ThemeId, RegisteredTheme>> = {
  "a-sys-status": { module: aSysStatus, themeColor: "#1d1d27", fonts: KIT_FONTS },
  "b-control-room": { module: bControlRoom, themeColor: B_THEME_COLOR, fonts: KIT_FONTS },
  "c-session": { module: cSession, themeColor: C_THEME_COLOR, fonts: KIT_FONTS },
  "d-classic": { module: dClassic, themeColor: D_THEME_COLOR, fonts: D_FONTS },
  "e-editorial": { module: eEditorial, themeColor: E_THEME_COLOR, fonts: E_FONTS },
  "f-dashboard": {
    module: fDashboard,
    themeColor: F_THEME_COLOR,
    themeColorDark: F_THEME_COLOR_DARK,
    fonts: F_FONTS,
  },
  "g-wallboard": { module: gWallboard, themeColor: G_THEME_COLOR, fonts: G_FONTS },
  "h-friendly": { module: hFriendly, themeColor: H_THEME_COLOR, fonts: H_FONTS },
  "i-minimal": {
    module: iMinimal,
    themeColor: I_THEME_COLOR,
    themeColorDark: I_THEME_COLOR_DARK,
    fonts: I_FONTS,
  },
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

/** One `<meta name="theme-color">`: its colour and, for a theme with a dark variant, its media query. */
export interface ThemeColorTag {
  content: string;
  media?: string;
}

/**
 * The head tags that follow the shown theme, rendered by the root document (src/client/routes/__root.tsx):
 * its `theme-color`, one tag, or a light and a dark one when the theme follows `prefers-color-scheme`, and
 * the font files to preload (only the shown theme's, so a Phase 7 page never preloads Geist). They are not
 * route `meta`: the router keeps one meta per `name`, which would drop the second `theme-color`.
 */
export function themeHead(theme: RegisteredTheme): { colors: ThemeColorTag[]; fonts: readonly string[] } {
  const colors: ThemeColorTag[] = theme.themeColorDark
    ? [
        { content: theme.themeColor, media: "(prefers-color-scheme: light)" },
        { content: theme.themeColorDark, media: "(prefers-color-scheme: dark)" },
      ]
    : [{ content: theme.themeColor }];
  return { colors, fonts: theme.fonts };
}
