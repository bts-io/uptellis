import type { ThemeModule } from "../types";
import { Page } from "./Page";

export const bControlRoom: ThemeModule = {
  id: "b-control-room",
  label: "Control Room",
  dataTheme: "b",
  Page,
};

/** `<meta name="theme-color">`: the page background (`--color-base` in tokens.css). */
export const THEME_COLOR = "#0a0c10";
