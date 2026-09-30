import type { ThemeModule } from "../types";
import { Page } from "./Page";

export const dClassic: ThemeModule = {
  id: "d-classic",
  label: "Classic",
  dataTheme: "d",
  Page,
};

/** `<meta name="theme-color">`: the page background (`--color-base` in tokens.css). */
export const THEME_COLOR = "#f6f7f9";

/** Self-hosted font files the page preloads: the `@font-face` sources in tokens.css. */
export const FONTS: readonly string[] = ["/fonts/Inter-Variable.woff2"];
