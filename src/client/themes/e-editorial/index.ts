import type { ThemeModule } from "../types";
import { Page } from "./Page";

export const eEditorial: ThemeModule = {
  id: "e-editorial",
  label: "Editorial",
  dataTheme: "e",
  Page,
};

/** `<meta name="theme-color">`: the page background (`--color-base` in tokens.css). */
export const THEME_COLOR = "#fbf8f3";

/** Self-hosted font files the page preloads: the `@font-face` sources in tokens.css. */
export const FONTS: readonly string[] = [
  "/fonts/Fraunces-Variable.woff2",
  "/fonts/SourceSerif4-Variable.woff2",
  "/fonts/SourceSerif4-Italic.woff2",
  "/fonts/Inter-Variable.woff2",
];
