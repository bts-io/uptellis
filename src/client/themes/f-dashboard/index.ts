import type { ThemeModule } from "../types";
import { Page } from "./Page";

export const fDashboard: ThemeModule = {
  id: "f-dashboard",
  label: "Dashboard",
  dataTheme: "f",
  Page,
};

/** `<meta name="theme-color">`: the page background (`--color-base` in tokens.css). */
export const THEME_COLOR = "#f3f5f9";

/** `<meta name="theme-color">` under `prefers-color-scheme: dark`: the dark `--color-base` in tokens.css. */
export const THEME_COLOR_DARK = "#0b0e16";

/** Self-hosted font files the page preloads: the `@font-face` sources in tokens.css. */
export const FONTS: readonly string[] = ["/fonts/Manrope-Variable.woff2"];
