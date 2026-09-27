import { Age } from "@/client/kit";
import type { IncidentView, SiteView } from "@/shared/view";
import { Block } from "./Block";
import { cx, dur, hhmmss, LEVEL_TEXT, monthDay } from "./format";

const WINDOW_DAYS = 30;

/** Open incidents expanded with their steps, then the last 30 days' resolved ones, collapsed. */
export function IncidentsBlock({ view }: { view: SiteView }) {
  const since = Date.parse(view.now) - WINDOW_DAYS * 86400_000;
  const open = view.incidents.open;
  const resolved = view.incidents.recent.filter(
    (i) => i.endedAt !== null && Date.parse(i.startedAt) >= since,
  );
  const days = new Set([...open, ...resolved].map((i) => i.startedAt.slice(0, 10))).size;
  const calm = [
    open.length ? `${open.length} open` : "No open incidents.",
    `${resolved.length} resolved in the last ${WINDOW_DAYS} days`,
  ];

  return (
    <Block
      id="incidents"
      title={`Incidents ${WINDOW_DAYS}d`}
      command={`incidents --${WINDOW_DAYS}d`}
      exitCode={open.length ? 1 : 0}
    >
      {open.length + resolved.length > 0 && (
        <ol className="relative m-0 list-none p-0 pl-[26px] before:absolute before:top-1.5 before:bottom-1.5 before:left-[5px] before:w-px before:bg-line before:content-['']">
          {open.map((i) => (
            <Incident key={i.id} incident={i} view={view} />
          ))}
          {resolved.map((i) => (
            <Incident key={i.id} incident={i} view={view} />
          ))}
        </ol>
      )}
      <p className="m-0 mt-4 font-sans text-[13px] leading-normal text-muted">
        {open.length ? `${calm[0]}, ${calm[1]}` : `${calm[0]} ${capital(calm[1]!)}`}
        {days < WINDOW_DAYS && `; the other ${WINDOW_DAYS - days} days were quiet`}.
      </p>
    </Block>
  );
}

/** The words next to a step: the notes (or what happened) on the first, the duration on the resolution. */
function stepText(i: IncidentView, step: IncidentView["steps"][number]): string {
  if (step === i.steps[0])
    return i.notes ?? `${i.subject} ${i.kind === "stale" ? "stopped reporting" : "went down"}.`;
  if (i.endedAt !== null && step.ts === i.endedAt) return `Back after ${dur(i.durationS)}.`;
  return "";
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Incident({ incident: i, view }: { incident: IncidentView; view: SiteView }) {
  const open = i.endedAt === null;
  const kind = i.kind === "stale" ? "stale" : "outage";
  return (
    <li className="relative pt-1 pb-4 last:pb-0" data-open={open}>
      <span
        aria-hidden="true"
        className={cx(
          "absolute top-[9px] -left-[26px] size-[11px] rounded-full",
          open
            ? "bg-down shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-down)_15%,transparent)]"
            : "bg-panel shadow-[inset_0_0_0_1.5px_var(--color-muted)]",
        )}
      />
      <details open={open} className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3.5 gap-y-0.5 [&::-webkit-details-marker]:hidden">
          <span
            className={cx(
              "rounded px-[7px] py-1 font-mono text-[11px] leading-none font-semibold tracking-[0.08em]",
              open ? "bg-down/12 text-down" : "bg-muted/10 text-muted",
            )}
          >
            {open ? "OPEN" : "RESOLVED"}
          </span>
          {!open && (
            <span className="font-mono text-[12.5px] leading-none text-muted">{monthDay(i.startedAt)}</span>
          )}
          <span className="font-sans text-[15px] leading-[1.4] font-medium">{i.title}</span>
          <span className="font-mono text-[12.5px] leading-none text-muted">
            {open ? (
              <>
                open <Age since={i.startedAt} now={view.now} suffix={false} />
              </>
            ) : (
              `${dur(i.durationS)} ${kind}`
            )}
          </span>
        </summary>
        <div className="mt-2.5 mb-0.5 grid grid-cols-[78px_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 text-[13px] md:grid-cols-[96px_104px_minmax(0,1fr)]">
          {i.steps.map((s) => (
            <div key={`${s.ts}-${s.label}`} className="contents">
              <time dateTime={s.ts} className="font-mono text-xs text-muted">
                {open ? `${hhmmss(s.ts)}Z` : `${monthDay(s.ts)} ${hhmmss(s.ts).slice(0, 5)}`}
              </time>
              <span className={cx("font-mono text-xs tracking-[0.06em] uppercase", LEVEL_TEXT[s.level])}>
                {s.label}
              </span>
              <span className="col-span-full font-sans leading-normal text-ink/80 max-md:mb-1.5 md:col-span-1">
                {stepText(i, s)}
              </span>
            </div>
          ))}
        </div>
      </details>
    </li>
  );
}
