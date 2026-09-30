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
