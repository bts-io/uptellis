import type { ThemeModule } from "../types";
import { Page } from "./Page";

export const gWallboard: ThemeModule = {
  id: "g-wallboard",
  label: "Wallboard",
  dataTheme: "g",
  Page,
};

/** `<meta name="theme-color">`: the page background (`--color-base` in tokens.css). */
export const THEME_COLOR = "#07090d";

/** Self-hosted font files the page preloads: the `@font-face` sources in tokens.css. */
export const FONTS: readonly string[] = [
  "/fonts/BarlowSemiCondensed-500.woff2",
  "/fonts/BarlowSemiCondensed-600.woff2",
  "/fonts/BarlowSemiCondensed-700.woff2",
  "/fonts/BarlowSemiCondensed-800.woff2",
];
