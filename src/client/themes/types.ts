import type { ComponentType } from "react";
import type { ThemeId } from "@/shared/config";
import type { SiteView } from "@/shared/view";

/**
 * A theme: one page component over `SiteView`. Themes import only `@/client/kit`, `@/client/effects`,
 * `@/shared/view` types and their own files (enforced by Biome), so swapping a theme never touches data code.
 */
export interface ThemeModule {
  id: ThemeId;
  label: string;
  /** `data-theme` value set on <html>; the theme's token CSS scopes its overrides to it. */
  dataTheme: string;
  Page: ComponentType<ThemePageProps>;
}

export interface ThemePageProps {
  view: SiteView;
  /** Build commit for the footer (from /api/health), when known. */
  commit: string | null;
}
