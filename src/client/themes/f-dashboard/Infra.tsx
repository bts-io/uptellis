import { Icon, isIconName } from "@/client/kit";
import { type FactGroupView, highlightedGroups, type Level, type SiteView } from "@/shared/view";
import { cx, LEVEL_TONE, when } from "./format";
import { Pill, SOFT, TONE_TEXT } from "./ui";

const LEVEL_WORD: Record<Level, string> = { ok: "Healthy", warn: "Warning", crit: "Critical", info: "Info" };
const LEVEL_GLYPH = { ok: "check", warn: "warn", crit: "x", info: "question" } as const;

/**
 * Every fact group the system facts card does not already show, one card each: icon, title, level, the
 * summary line in its coloured parts, then every row (a percentage also as a meter). Nothing without facts.
 * Not in the mock-up (it drew no facts beyond the highlights); added so any profile's facts show.
 */
export function Infra({ view }: { view: SiteView }) {
  const inFacts = highlightedGroups(view);
  const groups = view.factGroups.filter((g) => !inFacts.has(g.id));
  if (!groups.length) return null;
  return (
    <section id="infra" aria-labelledby="f-infra-h" className="mt-7">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="f-infra-h" className="m-0 text-lg font-extrabold tracking-[-0.01em]">
          Infrastructure
        </h2>
        <span className="text-[13px] font-semibold text-muted">
          {groups.filter((g) => g.level === "ok").length} of {groups.length} healthy
        </span>
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4 p-0">
        {groups.map((g) => (
          <Group key={g.id} group={g} />
        ))}
      </ul>
    </section>
  );
}

function Group({ group: g }: { group: FactGroupView }) {
  const tone = g.fresh ? LEVEL_TONE[g.level] : "stale";
  return (
    <li
      data-group={g.id}
      className="flex min-w-0 flex-col gap-3 rounded-[18px] border border-line bg-panel p-4 shadow-(--f-shadow) sm:p-[18px]"
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {isIconName(g.icon) && (
            <span className={cx("grid size-[30px] flex-none place-items-center rounded-[9px]", SOFT[tone])}>
              <Icon name={g.icon} size={16} />
            </span>
          )}
          <h3 className="m-0 text-[15.5px] leading-[1.3] font-bold">{g.title}</h3>
        </div>
        <Pill tone={tone} glyph={g.fresh ? LEVEL_GLYPH[g.level] : "clock"}>
          {g.fresh ? LEVEL_WORD[g.level] : "Stale"}
        </Pill>
      </div>
      {g.summaryParts.length > 0 && (
        <p className="m-0 text-[13px] [overflow-wrap:anywhere] text-(--f-text-2)">
          {g.summaryParts.map((p, i) => (
            <span key={i}>
              {i > 0 && " "}
              <span
                data-level={p.level ?? undefined}
                className={cx(
                  p.level && p.level !== "info" && TONE_TEXT[LEVEL_TONE[p.level]],
                  p.level === "info" && "text-muted",
                  p.emphasis && "font-bold",
                )}
              >
                {p.text}
              </span>
            </span>
          ))}
        </p>
      )}
      <ul className="m-0 list-none border-t border-hair p-0 pt-1">
        {g.rows.map((r) => (
          <li key={r.key} className="flex flex-col gap-1 border-t border-hair py-2 first:border-t-0">
            <div className="flex justify-between gap-3 text-[13.5px]">
              <span className="text-muted">{r.label}</span>
              <span
                className={cx(
                  "text-right font-bold [overflow-wrap:anywhere]",
                  r.level && r.level !== "ok" && r.level !== "info" && TONE_TEXT[LEVEL_TONE[r.level]],
                )}
              >
                {r.display}
              </span>
            </div>
            {r.percent !== null && (
              <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-hair">
                <span
                  className="block h-full rounded-[inherit] bg-[linear-gradient(90deg,var(--color-accent),var(--f-teal))]"
                  style={{ width: `${Math.min(100, Math.max(0, r.percent))}%` }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      <p className="m-0 text-[11.5px] text-muted">Observed {when(g.observedAt)}</p>
    </li>
  );
}
