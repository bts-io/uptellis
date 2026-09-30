import type { ThemeId } from "@/shared/config";

/**
 * The registered themes' `dataTheme` and `theme-color`, for SSR tests: the registry itself does not load in
 * workerd there (theme modules are browser code). tests/unit/client-preview.test.ts keeps this in sync.
 */
export const REGISTERED: Partial<Record<ThemeId, { dataTheme: string; themeColor: string }>> = {
  "a-sys-status": { dataTheme: "a", themeColor: "#1d1d27" },
  "b-control-room": { dataTheme: "b", themeColor: "#0a0c10" },
  "c-session": { dataTheme: "c", themeColor: "#050807" },
  "d-classic": { dataTheme: "d", themeColor: "#f6f7f9" },
  "i-minimal": { dataTheme: "i", themeColor: "#ffffff" },
  "e-editorial": { dataTheme: "e", themeColor: "#fbf8f3" },
  "h-friendly": { dataTheme: "h", themeColor: "#fff8f1" },
  "f-dashboard": { dataTheme: "f", themeColor: "#f3f5f9" },
  "g-wallboard": { dataTheme: "g", themeColor: "#07090d" },
};
