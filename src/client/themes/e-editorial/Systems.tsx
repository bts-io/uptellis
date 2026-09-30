import { highlightedGroups, highlightSlots, type Level, type SiteView } from "@/shared/view";
import { clock, cx, plural } from "./format";
import { PartHead } from "./ui";

const LEVEL_TEXT: Record<Level, string> = {
  ok: "text-up",
  warn: "text-degraded",
  crit: "text-down",
  info: "text-muted",
};

/** A level's colour, or none once the data is old (old data never reads green). */
const tone = (level: Level | null, stale: boolean) => (level && !stale ? LEVEL_TEXT[level] : undefined);

/**
 * "Behind the service": the profiles' highlights as a line of figures, then one short entry per fact group
 * (its summary line and its rows). Not in the mock-up, which predates facts; set in the same type.
 */
export function Systems({ view }: { view: SiteView }) {
  const slots = highlightSlots(view.highlights);
  const inFigures = highlightedGroups(view);
  const groups = view.factGroups.filter((g) => !inFigures.has(g.id));
  if (!slots.length && !groups.length) return null;
  const stale = view.freshness.state === "stale" || view.freshness.state === "empty";

  return (
    <section id="infra" className="pt-10" aria-labelledby="e-h-sys">
      <PartHead
        id="e-h-sys"
        title="Behind the service"
        aside={groups.length ? plural(groups.length, "report") : undefined}
      />
      {slots.length > 0 && (
        <dl className="m-0 mt-4 flex flex-wrap gap-x-6 gap-y-2 font-sans text-[0.85rem]">
          {slots.map((slot) => (
            <div key={slot.label} className="min-w-0">
              <dt className="text-[0.7rem] font-semibold tracking-[0.12em] text-muted uppercase">
                {slot.label}
              </dt>
              <dd className="m-0 [overflow-wrap:anywhere] text-ink">
                {slot.texts.join(" · ")}
                {slot.note && (
                  <span
                    className={cx(
                      "ml-[0.4rem] text-[0.72rem] font-semibold tracking-[0.06em] uppercase",
                      tone(slot.note.level, stale) ?? "text-muted",
                    )}
                  >
                    {slot.note.text}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="grid grid-cols-1 gap-x-8 min-[640px]:grid-cols-2">
        {groups.map((g) => {
          const old = stale || !g.fresh;
          return (
            <div key={g.id} data-group={g.id} className="mt-6 min-w-0">
              <h3 className="m-0 flex items-baseline justify-between gap-3 border-b border-(--e-rule) pb-1 font-(family-name:--e-serif-display) text-[1.15rem] font-semibold">
                {g.title}
                {!g.fresh && (
                  <span className="font-sans text-[0.72rem] font-medium text-muted">
                    as of {clock(g.observedAt)}
                  </span>
                )}
              </h3>
              {g.summaryParts.length > 0 && (
                <p className="m-0 mt-2 text-[0.98rem] text-(--e-ink-2)">
                  {g.summaryParts.map((p, i) => (
                    <span key={`${i}-${p.text}`}>
                      {i > 0 && " "}
                      <span
                        data-level={p.level ?? undefined}
                        className={cx(tone(p.level, old), p.emphasis && "font-semibold")}
                      >
                        {p.text}
                      </span>
                    </span>
                  ))}
                </p>
              )}
              <dl className="m-0 mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 font-sans text-[0.82rem]">
                {g.rows.map((r) => (
                  <div key={r.key} className="contents">
                    <dt className="border-b border-dotted border-(--e-rule) py-[0.3rem] text-muted">
                      {r.label}
                    </dt>
                    <dd
                      className={cx(
                        "m-0 border-b border-dotted border-(--e-rule) py-[0.3rem] text-right [overflow-wrap:anywhere]",
                        tone(r.level, old) ?? "text-ink",
                      )}
                    >
                      {r.display}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>
    </section>
  );
}
