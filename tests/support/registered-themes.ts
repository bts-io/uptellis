import type { ThemeId } from "@/shared/config";

/**
 * The registered themes' `dataTheme`, `theme-color` (with the dark one of a theme that follows
 * `prefers-color-scheme`) and preloaded fonts, for SSR tests: the registry itself does not load in workerd
 * there (theme modules are browser code). tests/unit/client-preview.test.ts keeps this in sync.
 */
export interface RegisteredEntry {
  dataTheme: string;
  themeColor: string;
  themeColorDark?: string;
  fonts: readonly string[];
}

const KIT = ["/fonts/Geist-Variable.woff2", "/fonts/JetBrainsMono-Variable.woff2"];

export const REGISTERED: Partial<Record<ThemeId, RegisteredEntry>> = {
  "a-sys-status": { dataTheme: "a", themeColor: "#1d1d27", fonts: KIT },
  "b-control-room": { dataTheme: "b", themeColor: "#0a0c10", fonts: KIT },
  "c-session": { dataTheme: "c", themeColor: "#050807", fonts: KIT },
  "d-classic": { dataTheme: "d", themeColor: "#f6f7f9", fonts: ["/fonts/Inter-Variable.woff2"] },
  "e-editorial": {
    dataTheme: "e",
    themeColor: "#fbf8f3",
    fonts: [
      "/fonts/Fraunces-Variable.woff2",
      "/fonts/SourceSerif4-Variable.woff2",
      "/fonts/SourceSerif4-Italic.woff2",
      "/fonts/Inter-Variable.woff2",
    ],
  },
  "f-dashboard": {
    dataTheme: "f",
    themeColor: "#f3f5f9",
    themeColorDark: "#0b0e16",
    fonts: ["/fonts/Manrope-Variable.woff2"],
  },
  "g-wallboard": {
    dataTheme: "g",
    themeColor: "#07090d",
    fonts: [
      "/fonts/BarlowSemiCondensed-500.woff2",
      "/fonts/BarlowSemiCondensed-600.woff2",
      "/fonts/BarlowSemiCondensed-700.woff2",
      "/fonts/BarlowSemiCondensed-800.woff2",
    ],
  },
  "h-friendly": { dataTheme: "h", themeColor: "#fff8f1", fonts: ["/fonts/Nunito-Variable.woff2"] },
  "i-minimal": { dataTheme: "i", themeColor: "#ffffff", themeColorDark: "#111214", fonts: [] },
};
