import { SummaryParts } from "@/client/kit";
import {
  type FactGroupView,
  highlightedGroups,
  highlightSlots,
  type Level,
  type SiteView,
} from "@/shared/view";
import { cx } from "./format";
import { BlockHead, GroupCard, GroupHead, LEVEL_STATE, STATE_TEXT, StateTag } from "./ui";

const LEVEL_LABEL: Record<Level, string> = { ok: "Healthy", warn: "Warning", crit: "Critical", info: "Info" };

/** Kit colours set to the darker text shades, so coloured words keep AA contrast on white. */
const TEXT_SHADES =
  "[--color-up:var(--d-up-text)] [--color-degraded:var(--d-degraded-text)] [--color-down:var(--d-down-text)]";

const BADGE: Record<Level, string> = {
  ok: "bg-(--d-up-tint) text-(--d-up-text)",
  warn: "bg-(--d-degraded-tint) text-(--d-degraded-text)",
  crit: "bg-(--d-down-tint) text-(--d-down-text)",
  info: "bg-(--d-stale-tint) text-(--d-stale-text)",
};

const valueText = (level: Level | null) =>
  level && level !== "info" ? STATE_TEXT[LEVEL_STATE[level]] : "text-ink";

/**
 * What the site's profiles report beyond the monitors (not in the mock-up, which drew no facts): the
 * headline, the highlights as an "At a glance" card, then one expandable row per other fact group.
 */
export function System({ view }: { view: SiteView }) {
  const slots = highlightSlots(view.highlights);
  const inSlots = highlightedGroups(view);
  const groups = view.factGroups.filter((g) => !inSlots.has(g.id));
  if (!slots.length && !groups.length && !view.headline) return null;
  return (
    <section aria-labelledby="d-h-sys" className={cx("mt-9 max-[600px]:mt-7", TEXT_SHADES)}>
      <BlockHead id="d-h-sys" title="System details" />
      {view.headline && <p className="mt-0 mb-3 text-sm text-muted">{view.headline}</p>}
      {slots.length > 0 && (
        <GroupCard labelledBy="d-g-glance">
          <GroupHead>
            <h3 id="d-g-glance" className="m-0 text-[15px] font-semibold">
              At a glance
            </h3>
          </GroupHead>
          <dl className="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-6 px-5 py-2 text-sm max-[600px]:grid-cols-1 max-[600px]:px-3.5">
            {slots.map((s) => (
              <div key={s.label} className="contents">
                <dt className="pt-2 font-medium text-muted capitalize max-[600px]:pt-2.5">{s.label}</dt>
                <dd className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 pt-2 pb-1 [overflow-wrap:anywhere] max-[600px]:pt-0.5">
                  <span>{s.texts.join(" · ")}</span>
                  {s.note && (
                    <span
                      data-level={s.note.level}
                      className={cx(
                        "inline-block rounded-full px-[7px] py-px text-[11.5px] font-semibold",
                        BADGE[s.note.level],
                      )}
                    >
                      {s.note.text}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </GroupCard>
      )}
      {groups.length > 0 && (
        <GroupCard labelledBy="d-g-components">
          <GroupHead>
            <h3 id="d-g-components" className="m-0 text-[15px] font-semibold">
              Components
            </h3>
          </GroupHead>
          <ul className="m-0 list-none p-0">
            {groups.map((g) => (
              <Group key={g.id} group={g} />
            ))}
          </ul>
        </GroupCard>
      )}
    </section>
  );
}

function Group({ group: g }: { group: FactGroupView }) {
  return (
    <li className="not-first:border-t not-first:border-line">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5 max-[600px]:px-3.5 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[15px] font-medium">
              <Chevron />
              {g.title}
            </span>
            {g.summaryParts.length > 0 && (
              <SummaryParts
                parts={g.summaryParts}
                stale={!g.fresh}
                className="mt-0.5 block pl-5 text-[13px] text-muted [overflow-wrap:anywhere]"
              />
            )}
          </span>
          {g.fresh ? (
            <StateTag state={LEVEL_STATE[g.level]} label={LEVEL_LABEL[g.level]} />
          ) : (
            <StateTag state="stale" />
          )}
        </summary>
        <dl className="m-0 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-6 gap-y-1.5 px-5 pb-4 pl-12 text-[13.5px] max-[600px]:grid-cols-1 max-[600px]:gap-y-0 max-[600px]:px-3.5 max-[600px]:pl-8">
          {g.rows.map((r) => (
            <div key={r.key} className="contents">
              <dt className="text-muted max-[600px]:pt-1.5">{r.label}</dt>
              <dd className={cx("m-0 [overflow-wrap:anywhere]", g.fresh ? valueText(r.level) : "text-ink")}>
                {r.display}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </li>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
      className="size-3 flex-none text-faint transition-transform group-open:rotate-90 motion-reduce:transition-none"
    >
      <path
        d="M4.5 2.5L8 6l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
