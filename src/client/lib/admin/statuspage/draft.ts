/**
 * The Status page screen's draft: the parts of the site config the screen edits (page title, who can see
 * it, theme, sections, public names, public settings), the pure edits the editor makes to it, and the
 * preview's view rebuilt from it.
 *
 *   const draft = draftOf(config);
 *   const next = moveService(draft, { section: 0, index: 2 }, { section: 1, index: 0 });
 *   await cfg.save((c) => applyDraft(c, next), "Updated the status page");
 *
 * The preview (`previewView`) applies the draft to the loaded `SiteView` instead of calling
 * `buildSiteView`: the admin has the view, not the raw model `buildSiteView` needs. It does what
 * `buildSiteView` does with sections: unknown ids skipped, empty sections left out, the rest unsectioned,
 * names from `displayNames` (else the service's own name), the section state the worst of its services.
 */
import type { SiteConfig } from "@/shared/config";
import { monitorServiceId, monitorsOf } from "@/shared/monitors";
import type { DisplayState, ServiceView, SiteView } from "@/shared/view";
import { worstState } from "@/shared/view/state";
import { viewServices } from "../monitors/model";

export interface PageDraft {
  title: string;
  visibility: SiteConfig["visibility"];
  theme: SiteConfig["theme"];
  sections: SiteConfig["sections"];
  displayNames: SiteConfig["displayNames"];
  public: SiteConfig["public"];
}

export const draftOf = (c: SiteConfig): PageDraft => ({
  title: c.branding.title,
  visibility: c.visibility,
  theme: c.theme,
  sections: c.sections,
  displayNames: c.displayNames,
  public: c.public,
});

/** The config with the draft applied (the rest of `branding` kept). */
export const applyDraft = (c: SiteConfig, d: PageDraft): SiteConfig => ({
  ...c,
  branding: { ...c.branding, title: d.title },
  visibility: d.visibility,
  theme: d.theme,
  sections: d.sections,
  displayNames: d.displayNames,
  public: d.public,
});

export const sameDraft = (a: PageDraft, b: PageDraft) => JSON.stringify(a) === JSON.stringify(b);

/** What the picker groups a service under. */
export type ServiceGroup = "monitor" | "heartbeat" | "other";
export const GROUP_LABEL: Record<ServiceGroup, string> = {
  monitor: "Monitors",
  heartbeat: "Heartbeats",
  other: "Other services",
};

export interface CatalogEntry {
  id: string;
  /** The service's own name: its monitor's name, else the name its source reports. */
  name: string;
  group: ServiceGroup;
  /** A short second line (the target, "Heartbeat"); never an id. */
  detail: string | null;
  /** Its state on the page now; null when it has not reported yet. */
  state: DisplayState | null;
  /** False while the service has no data: the page leaves it out until it reports. */
  reported: boolean;
}

/**
 * Every service the screen can place: the config's monitors (heartbeats apart), then the view's other
 * services. A section may still list an id neither knows (a removed monitor); `entryFor` names it.
 *
 * A non-monitor service with a saved public name shows that name as its own: the view carries only the
 * name with `displayNames` applied, and the source's own name is not in the admin's data.
 */
export function catalogOf(config: SiteConfig, view: SiteView | null): CatalogEntry[] {
  const services = new Map(viewServices(view).map((s) => [s.id, s]));
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  for (const m of monitorsOf(config)) {
    const id = monitorServiceId(m.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const s = services.get(id);
    out.push({
      id,
      name: m.name,
      group: m.type === "push" ? "heartbeat" : "monitor",
      detail: m.type === "push" ? "Heartbeat" : (s?.targetDisplay ?? null),
      state: s?.state ?? null,
      reported: !!s,
    });
  }
  for (const s of services.values()) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push({
      id: s.id,
      name: s.name,
      group: "other",
      detail: s.targetDisplay,
      state: s.state,
      reported: true,
    });
  }
  return out;
}

/** The catalog entry for an id, or a nameless stand-in for an id nothing knows (never the id itself). */
export function entryFor(catalog: readonly CatalogEntry[], id: string): CatalogEntry {
  return (
    catalog.find((e) => e.id === id) ?? {
      id,
      name: "Unknown service",
      group: "other",
      detail: "Nothing reports under it any more",
      state: null,
      reported: false,
    }
  );
}

/** The name the page shows for a service: its public name, else its own. */
export const publicName = (d: PageDraft, e: CatalogEntry) => d.displayNames[e.id] || e.name;

export interface Place {
  section: number;
  index: number;
}

/** Where a service sits on the page, or null when no section lists it. */
export function placeOf(d: PageDraft, id: string): Place | null {
  for (const [section, s] of d.sections.entries()) {
    const index = s.services.indexOf(id);
    if (index >= 0) return { section, index };
  }
  return null;
}

const withSections = (d: PageDraft, sections: PageDraft["sections"]): PageDraft => ({ ...d, sections });

/** A section id no other section has (`section-<n>`, the shape the schema accepts). */
function freshSectionId(sections: PageDraft["sections"]): string {
  const ids = new Set(sections.map((s) => s.id));
  let n = sections.length + 1;
  while (ids.has(`section-${n}`)) n++;
  return `section-${n}`;
}

export const addSection = (d: PageDraft, title = "New section"): PageDraft =>
  withSections(d, [...d.sections, { id: freshSectionId(d.sections), title, services: [] }]);

export const renameSection = (d: PageDraft, i: number, title: string): PageDraft =>
  withSections(
    d,
    d.sections.map((s, j) => (j === i ? { ...s, title } : s)),
  );

/** Removes a section; its services go off the page (they stay in the catalog). */
export const removeSection = (d: PageDraft, i: number): PageDraft =>
  withSections(
    d,
    d.sections.filter((_, j) => j !== i),
  );

export function moveSection(d: PageDraft, i: number, by: -1 | 1): PageDraft {
  const j = i + by;
  if (j < 0 || j >= d.sections.length) return d;
  const next = [...d.sections];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return withSections(d, next);
}

/** Adds a service at the end of a section, taking it out of any other section first. */
export function addService(d: PageDraft, section: number, id: string): PageDraft {
  const without = d.sections.map((s) => ({ ...s, services: s.services.filter((x) => x !== id) }));
  return withSections(
    d,
    without.map((s, j) => (j === section ? { ...s, services: [...s.services, id] } : s)),
  );
}

export const removeService = (d: PageDraft, id: string): PageDraft =>
  withSections(
    d,
    d.sections.map((s) => ({ ...s, services: s.services.filter((x) => x !== id) })),
  );

/**
 * Moves the service at `from` to `to` (`to.index` counted in the target section before the move, so
 * dropping on a row puts the service where that row was). Answers the draft unchanged when `from` is empty.
 */
export function moveService(d: PageDraft, from: Place, to: Place): PageDraft {
  const id = d.sections[from.section]?.services[from.index];
  if (id === undefined || !d.sections[to.section]) return d;
  const sections = d.sections.map((s) => ({ ...s, services: [...s.services] }));
  sections[from.section]!.services.splice(from.index, 1);
  let index = to.index;
  if (from.section === to.section && from.index < to.index) index--;
  const target = sections[to.section]!.services;
  target.splice(Math.max(0, Math.min(index, target.length)), 0, id);
  return withSections(d, sections);
}

/**
 * One keyboard step for the service at `from`, as a `moveService` target: up or down in its section, and
 * past the first or last row into the previous section's end or the next section's start. Null when there
 * is nowhere to go.
 */
export function stepTarget(d: PageDraft, from: Place, by: -1 | 1): Place | null {
  const count = d.sections[from.section]?.services.length ?? 0;
  const index = from.index + by;
  if (index >= 0 && index < count) return { section: from.section, index: by < 0 ? index : index + 1 };
  const section = from.section + by;
  const other = d.sections[section];
  if (!other) return null;
  return by < 0 ? { section, index: other.services.length } : { section, index: 0 };
}

/** Where `moveService` leaves the service when moved to `to` (for focus and the announcement). */
export function landing(from: Place, to: Place, sizeAfter: number): Place {
  const index = from.section === to.section && from.index < to.index ? to.index - 1 : to.index;
  return { section: to.section, index: Math.max(0, Math.min(index, sizeAfter - 1)) };
}

/** Sets a service's public name; empty (or the same as its own name) clears it. */
export function setPublicName(d: PageDraft, e: CatalogEntry, name: string): PageDraft {
  const { [e.id]: _, ...rest } = d.displayNames;
  return { ...d, displayNames: name.trim() && name !== e.name ? { ...rest, [e.id]: name } : rest };
}

/**
 * The loaded view with the draft applied, for the preview: the draft's theme and title, its sections in
 * its order (services the view has, under their public names), every other service unsectioned in the
 * view's order, and incident subjects under the new names. Verdict, summary and the rest stay as loaded:
 * none of them depends on sections or names.
 */
export function previewView(view: SiteView, d: PageDraft, catalog: readonly CatalogEntry[]): SiteView {
  const named = new Map<string, ServiceView>();
  for (const s of viewServices(view)) {
    const e = entryFor(catalog, s.id);
    named.set(s.id, { ...s, name: d.displayNames[s.id] || (e.reported ? e.name : s.name) });
  }
  const placed = new Set<string>();
  const sections = d.sections.flatMap((sec) => {
    const services = sec.services.flatMap((id) => {
      const s = named.get(id);
      if (!s || placed.has(id)) return [];
      placed.add(id);
      return [s];
    });
    if (services.length === 0) return [];
    return [
      {
        id: sec.id,
        title: sec.title,
        state: worstState(services.map((s) => s.state)),
        exitCode: services.every((s) => s.state === "up" || s.state === "maintenance")
          ? (0 as const)
          : (1 as const),
        services,
      },
    ];
  });
  const rename = <T extends { serviceId: string | null; subject: string }>(i: T): T => {
    const s = i.serviceId ? named.get(i.serviceId) : undefined;
    return s ? { ...i, subject: s.name } : i;
  };
  return {
    ...view,
    theme: d.theme,
    branding: { ...view.branding, title: d.title },
    sections,
    unsectioned: [...named.values()].filter((s) => !placed.has(s.id)),
    incidents: { open: view.incidents.open.map(rename), recent: view.incidents.recent.map(rename) },
  };
}
