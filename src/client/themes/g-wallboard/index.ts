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
