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
