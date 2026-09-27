import type { ThemeModule } from "../types";
import { Page } from "./Page";

/** `<meta name="theme-color">`: the page background (`--color-base` in tokens.css). */
export const THEME_COLOR = "#050807";

export const cSession: ThemeModule = {
  id: "c-session",
  label: "Session",
  dataTheme: "c",
  Page,
};
