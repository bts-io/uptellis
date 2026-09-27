import { cx } from "./cx";
import { Gauge } from "./gauge";
import type { FactListProps } from "./props";
import { LEVEL_TONE, TEXT } from "./tone";

/** Label/value rows of a fact group; percentages get a gauge, values take their level colour. */
export function FactList({ rows }: FactListProps) {
  return (
    <dl className="m-0 font-mono text-[13px]">
      {rows.map((r) => (
        <div
          key={`${r.group}.${r.key}`}
          data-fact={`${r.group}.${r.key}`}
          className="grid grid-cols-[11ch_minmax(0,1fr)] items-center gap-x-2.5 border-b border-dashed border-hair py-[7px] last:border-b-0 last:pb-0"
        >
          <dt className="truncate font-semibold text-accent">{r.label}</dt>
          <dd className="m-0 flex min-w-0 items-center gap-2">
            {r.percent !== null && (
              <Gauge value={r.percent} cells={12} level={r.level ?? "ok"} label={r.label} />
            )}
            <span className={cx("truncate", r.level ? TEXT[LEVEL_TONE[r.level]] : "text-ink")}>
              {r.display}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
