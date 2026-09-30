import { SummaryParts } from "@/client/kit";
import {
  type FactGroupView,
  highlightedGroups,
  highlightSlots,
  type Level,
  type SiteView,
} from "@/shared/view";
import { cx } from "./format";
import { Label, LEVEL_STATE, State } from "./ui";

const LEVEL_WORD: Record<Level, string> = { ok: "OK", warn: "Warning", crit: "Critical", info: "Info" };

/** Kit colours set to the text shades, so coloured words keep AA contrast in both schemes. */
const TEXT_SHADES =
  "[--color-up:var(--i-up-text)] [--color-degraded:var(--i-degraded-text)] [--color-down:var(--i-down-text)]";

const NOTE: Record<Level, string> = {
  ok: "text-(--i-up-text)",
  warn: "text-(--i-degraded-text)",
  crit: "text-(--i-down-text)",
  info: "text-faint",
};

const ROW = "border-t border-line last:border-b";

/**
 * What the site's profiles report beyond the monitors (not in the mock-up, which drew no facts), kept to
 * the same hairline rows: the headline, one row per highlight, one row per other fact group that opens to
 * its facts.
 */
export function System({ view }: { view: SiteView }) {
  const slots = highlightSlots(view.highlights);
  const inSlots = highlightedGroups(view);
  const groups = view.factGroups.filter((g) => !inSlots.has(g.id));
  if (!slots.length && !groups.length && !view.headline) return null;
  return (
    <section aria-labelledby="i-h-sys" className={cx("mt-12 max-[560px]:mt-[38px]", TEXT_SHADES)}>
      <Label id="i-h-sys">System</Label>
      {view.headline && <p className="mt-0 mb-2.5 text-sm text-muted">{view.headline}</p>}
      {(slots.length > 0 || groups.length > 0) && (
        <ul className="m-0 list-none p-0">
          {slots.map((s) => (
            <li
              key={s.label}
              className={cx(ROW, "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 py-[9px]")}
            >
              <span className="min-w-0 truncate capitalize">{s.label}</span>
              <span className="min-w-0 text-right text-[13px] text-muted [overflow-wrap:anywhere]">
                {s.texts.join(" · ")}
                {s.note && (
                  <span data-level={s.note.level} className={cx("ml-2 font-semibold", NOTE[s.note.level])}>
                    {s.note.text}
                  </span>
                )}
              </span>
            </li>
          ))}
          {groups.map((g) => (
            <Group key={g.id} group={g} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Group({ group: g }: { group: FactGroupView }) {
  return (
    <li className={ROW}>
      <details>
        <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-[9px] [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block truncate">{g.title}</span>
            {g.summaryParts.length > 0 && (
              <SummaryParts
                parts={g.summaryParts}
                stale={!g.fresh}
                className="block text-[13px] text-muted [overflow-wrap:anywhere]"
              />
            )}
          </span>
          {g.fresh ? (
            <State state={LEVEL_STATE[g.level]} label={LEVEL_WORD[g.level]} />
          ) : (
            <State state="stale" />
          )}
        </summary>
        <dl className="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-5 gap-y-1 pb-3 text-[13px] max-[560px]:grid-cols-1 max-[560px]:gap-y-0">
          {g.rows.map((r) => (
            <div key={r.key} className="contents">
              <dt className="text-faint max-[560px]:pt-1.5">{r.label}</dt>
              <dd
                className={cx(
                  "m-0 [overflow-wrap:anywhere]",
                  g.fresh && r.level && r.level !== "info" ? NOTE[r.level] : "text-ink",
                )}
              >
                {r.display}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  );
}
