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
