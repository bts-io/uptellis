import type { ThemeModule } from "../types";
import { Page } from "./Page";

export const iMinimal: ThemeModule = {
  id: "i-minimal",
  label: "Minimal",
  dataTheme: "i",
  Page,
};

/** `<meta name="theme-color">`: the page background (`--color-base` in tokens.css). */
export const THEME_COLOR = "#ffffff";

/** `<meta name="theme-color">` under `prefers-color-scheme: dark`: the dark `--color-base` in tokens.css. */
export const THEME_COLOR_DARK = "#111214";

/** Font files the page preloads: none, the theme uses the system font stack (tokens.css). */
export const FONTS: readonly string[] = [];
