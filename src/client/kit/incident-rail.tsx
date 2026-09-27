import { Age } from "./age";
import { cx } from "./cx";
import { fmtAge, utcHm, utcTime } from "./format";
import type { IncidentRailProps } from "./props";
import { LEVEL_TONE, TEXT } from "./tone";

const STEP =
  "flex items-center gap-2 pr-2.5 after:h-px after:w-[34px] after:bg-hair after:content-[''] last:after:hidden";

/**
 * Incident block: title, subject, start time and a live duration while open, notes, and the step rail
 * (detected, updates, resolved). An open incident ends the rail with a hollow "resolved" step still to come.
 */
export function IncidentRail({ incident, now }: IncidentRailProps) {
  const open = incident.endedAt === null;
  return (
    <article aria-label={`Incident: ${incident.title}`} data-open={open} className="font-mono">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h3 className="m-0 font-sans text-[17px] font-semibold tracking-[-0.01em] text-ink">
          {incident.title}
        </h3>
        <p className="m-0 text-xs text-muted">
          {incident.subject} · started{" "}
          <time dateTime={incident.startedAt}>{utcTime(incident.startedAt)}</time> UTC ·{" "}
          {open ? "open " : "lasted "}
          <b className={cx("font-semibold", open ? "text-down" : "text-ink")}>
            {open ? <Age since={incident.startedAt} now={now} suffix={false} /> : fmtAge(incident.durationS)}
          </b>
        </p>
      </div>
      {incident.notes && (
        <p className="mt-1.5 mb-0 max-w-[86ch] font-sans text-sm leading-relaxed text-ink/85">
          {incident.notes}
        </p>
      )}
      <ol aria-label="Timeline" className="m-0 mt-3.5 flex list-none flex-wrap p-0 text-[11.5px]">
        {incident.steps.map((s) => (
          <li key={`${s.ts}-${s.label}`} className={cx(STEP, TEXT[LEVEL_TONE[s.level]])}>
            <span aria-hidden="true" className="inline-block size-2 rounded-full bg-current" />
            {s.label} <time dateTime={s.ts}>{utcHm(s.ts)}</time>
          </li>
        ))}
        {open && (
          <li className={cx(STEP, "text-faint")}>
            <span
              aria-hidden="true"
              className="inline-block size-2 rounded-full shadow-[inset_0_0_0_1.5px_currentColor]"
            />
            resolved
          </li>
        )}
      </ol>
    </article>
  );
}
