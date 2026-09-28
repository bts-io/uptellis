import type { FactRowView, HighlightView, SiteView } from "./types";

/**
 * The slots of the figures a theme draws itself from `SiteView.summary` (`Highlight.slot`, contract
 * addition): a theme that mixes highlights among its own figures orders them all by slot, so a profile can
 * place a highlight between two figures.
 */
export const SUMMARY_SLOTS = {
  monitors: 10,
  avgLatency: 20,
  health: 40,
  uptime24h: 50,
  uptime30d: 60,
  snapshot: 80,
} as const;

/**
 * Highlights that share a label, as one summary slot: the first row is the value, the others its detail;
 * `note` is the first highlight's badge and `slot` its place (null when it has none).
 */
export interface HighlightSlot {
  label: string;
  rows: [FactRowView, ...FactRowView[]];
  /** Each row's text as the slot shows it: its display after the highlight's `prefix` ("db 41.2 MB"). */
  texts: [string, ...string[]];
  note: HighlightView["note"];
  slot: number | null;
}

const prefixed = (h: HighlightView) => (h.prefix ? `${h.prefix} ${h.row.display}` : h.row.display);

/** `SiteView.highlights` grouped by label, in the order each label first appears (so by slot). */
export function highlightSlots(highlights: readonly HighlightView[]): HighlightSlot[] {
  const slots: HighlightSlot[] = [];
  for (const h of highlights) {
    const slot = slots.find((s) => s.label === h.label);
    if (slot) {
      slot.rows.push(h.row);
      slot.texts.push(prefixed(h));
    } else slots.push({ label: h.label, rows: [h.row], texts: [prefixed(h)], note: h.note, slot: h.slot });
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
