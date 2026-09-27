/**
 * Command palette entries, built from the view and the theme registry. Pure: the shell runs the chosen
 * entry's action, so the list and its filter are unit tested without a DOM.
 */
import type { ThemeId } from "@/shared/config";
import type { ServiceView, SiteView } from "@/shared/view";
import type { RegisteredTheme } from "../themes";

export type PaletteAction =
  | { kind: "service"; serviceId: string }
  | { kind: "copy"; serviceId: string; name: string; text: string }
  /** `null` leaves the preview for the site's own theme. */
  | { kind: "theme"; theme: ThemeId | null }
  | { kind: "admin" };

export interface PaletteItem {
  id: string;
  group: "service" | "copy" | "theme" | "admin";
  label: string;
  /** Muted text after the label (state, theme id). */
  hint: string | null;
  action: PaletteAction;
}

/** Every service on the page, sections first (in page order), then the unsectioned ones. */
export function pageServices(view: SiteView): ServiceView[] {
  return [...view.sections.flatMap((s) => s.services), ...view.unsectioned];
}

/** Anchor id of a service's card; every theme sets it so the palette can jump there. */
export const serviceAnchor = (serviceId: string) => `svc-${serviceId}`;

export interface PaletteContext {
  view: SiteView;
  themes: RegisteredTheme[];
  /** The site's own theme while a preview is shown, else undefined. */
  siteTheme: ThemeId | undefined;
  /** Whether the admin API answered for this site (checked when the palette opens). */
  admin: boolean;
}

export function paletteItems({ view, themes, siteTheme, admin }: PaletteContext): PaletteItem[] {
  const services = pageServices(view);
  const items: PaletteItem[] = services.map((s) => ({
    id: `service:${s.id}`,
    group: "service",
    label: s.name,
    hint: s.state,
    action: { kind: "service", serviceId: s.id },
  }));
  for (const t of themes) {
    if (t.module.id === view.theme) continue;
    const own = t.module.id === siteTheme;
    items.push({
      id: `theme:${t.module.id}`,
      group: "theme",
      label: own ? `Back to ${t.module.label}` : `Preview ${t.module.label}`,
      hint: own ? "site theme" : t.module.id,
      action: { kind: "theme", theme: own ? null : t.module.id },
    });
  }
  for (const s of services)
    items.push({
      id: `copy:${s.id}`,
      group: "copy",
      label: `Copy beats: ${s.name}`,
      hint: "90 days",
      action: { kind: "copy", serviceId: s.id, name: s.name, text: s.beatsText },
    });
  if (admin)
    items.push({ id: "admin", group: "admin", label: "Open admin", hint: null, action: { kind: "admin" } });
  return items;
}

/** Case-insensitive match of every word in `query` against the label, hint and group. */
export function filterItems(items: PaletteItem[], query: string): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((it) => {
    const hay = `${it.label} ${it.hint ?? ""} ${it.group}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
