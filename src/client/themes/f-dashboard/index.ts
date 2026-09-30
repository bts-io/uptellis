import type { ThemeModule } from "../types";
import { Page } from "./Page";

export const fDashboard: ThemeModule = {
  id: "f-dashboard",
  label: "Dashboard",
  dataTheme: "f",
  Page,
};

/** `<meta name="theme-color">`: the page background (`--color-base` in tokens.css). */
export const THEME_COLOR = "#f3f5f9";
