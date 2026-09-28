import type { FactRowView, HighlightView, SiteView } from "./types";

/**
 * Highlights that share a label, as one summary slot: the first row is the value, the others its detail;
 * `note` is the first highlight's badge.
 */
export interface HighlightSlot {
  label: string;
  rows: [FactRowView, ...FactRowView[]];
  note: HighlightView["note"];
}

/** `SiteView.highlights` grouped by label, in the order each label first appears. */
export function highlightSlots(highlights: readonly HighlightView[]): HighlightSlot[] {
  const slots: HighlightSlot[] = [];
  for (const h of highlights) {
    const slot = slots.find((s) => s.label === h.label);
    if (slot) slot.rows.push(h.row);
    else slots.push({ label: h.label, rows: [h.row], note: h.note });
  }
  return slots;
}

/** Fact groups a highlight comes from: themes that show highlights in a summary leave these out of infra. */
export function highlightedGroups(view: Pick<SiteView, "highlights">): Set<string> {
  return new Set(view.highlights.map((h) => h.row.group));
}

/** The name of the site's first source of `kind` (`kuma:watch-1` -> `watch-1`), for a footer or header. */
export function sourceName(view: Pick<SiteView, "freshness">, kind: string): string | null {
  const id = view.freshness.perSource.find((s) => s.kind === kind)?.id;
  return id ? id.slice(id.indexOf(":") + 1) : null;
}
