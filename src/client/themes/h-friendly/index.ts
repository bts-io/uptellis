import type { ThemeModule } from "../types";
import { Page } from "./Page";

export const hFriendly: ThemeModule = {
  id: "h-friendly",
  label: "Friendly",
  dataTheme: "h",
  Page,
};

/** `<meta name="theme-color">`: the page background (`--color-base` in tokens.css). */
export const THEME_COLOR = "#fff8f1";

/** Self-hosted font files the page preloads: the `@font-face` sources in tokens.css. */
export const FONTS: readonly string[] = ["/fonts/Nunito-Variable.woff2"];
