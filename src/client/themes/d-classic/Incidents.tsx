import type { IncidentView, SiteView } from "@/shared/view";
import { fmtDay, fmtDayTime, fmtDur, fmtTime } from "./format";
import { BlockHead, LiveAge } from "./ui";

/** Open incidents, prominent: title, how long, what it affects, notes and the steps newest first. */
export function OpenIncidents({ view }: { view: SiteView }) {
  const open = view.incidents.open;
  if (!open.length) return null;
  return (
    <section aria-labelledby="d-h-open" className="mt-9 max-[600px]:mt-7">
      <BlockHead id="d-h-open" title="Active incidents" aside={`${open.length} ongoing`} />
      {open.map((inc) => (
        <OpenIncident key={inc.id} incident={inc} now={view.now} />
      ))}
    </section>
  );
}

function OpenIncident({ incident: inc, now }: { incident: IncidentView; now: string }) {
  const steps = [...inc.steps].reverse();
  return (
    <article className="mb-3 rounded-lg border border-(--d-down-border) border-l-4 border-l-down bg-panel px-5 py-[18px]">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="m-0 text-base font-semibold text-(--d-down-text)">{inc.title}</h3>
        <span className="text-[13px] text-muted">
          Ongoing for <LiveAge seconds={inc.durationS} now={now} ago={false} />
        </span>
      </header>
      <p className="mt-1 mb-3 text-[13.5px] text-muted">
        {inc.kind === "stale" ? "Monitoring source " : "Affected service: "}
        <strong>{inc.subject}</strong>
      </p>
      {inc.notes && <p className="mt-0 mb-3">{inc.notes}</p>}
      {steps.length > 0 && (
        <ol className="m-0 list-none border-t border-line p-0">
          {steps.map((s) => (
            <li
              key={`${s.ts}-${s.label}`}
              className="grid grid-cols-[120px_1fr] gap-3 pt-2.5 text-sm max-[600px]:grid-cols-1 max-[600px]:gap-0"
            >
              <span className="font-semibold">{s.label}</span>
              <time dateTime={s.ts} className="text-[13px] text-muted">
                {fmtDayTime(s.ts)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

/** Past incidents grouped by the day they started, newest day first. */
export function PastIncidents({ view }: { view: SiteView }) {
  const recent = view.incidents.recent;
  const days: { key: string; items: IncidentView[] }[] = [];
  for (const inc of recent) {
    const key = inc.startedAt.slice(0, 10);
    const day = days.find((d) => d.key === key);
    if (day) day.items.push(inc);
    else days.push({ key, items: [inc] });
  }
  return (
    <section aria-labelledby="d-h-hist" className="mt-9 max-[600px]:mt-7">
      <BlockHead id="d-h-hist" title="Past incidents" />
      {days.length ? (
        <ol className="m-0 list-none p-0">
          {days.map((d) => (
            <li
              key={d.key}
              className="border-t border-(--d-border-strong) py-[18px] first:border-t-0 first:pt-1"
            >
              <h3 className="m-0 mb-2.5 text-[15px] font-semibold">
                <time dateTime={d.key}>{fmtDay(d.key)}</time>
              </h3>
              <ul className="m-0 list-none p-0">
                {d.items.map((inc) => (
                  <PastIncident key={inc.id} incident={inc} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : (
        <p className="m-0 text-sm text-muted">No incidents reported recently.</p>
      )}
    </section>
  );
}

function PastIncident({ incident: inc }: { incident: IncidentView }) {
  const stale = inc.kind === "stale";
  return (
    <li className="pt-1.5 pb-2.5">
      <h4 className="m-0 text-[15px] font-semibold">
        <span
          data-k={inc.kind}
          className={
            stale
              ? "mr-2 inline-block rounded-full bg-(--d-stale-tint) px-[7px] py-px align-[1px] text-[11.5px] font-semibold text-(--d-stale-text)"
              : "mr-2 inline-block rounded-full bg-(--d-down-tint) px-[7px] py-px align-[1px] text-[11.5px] font-semibold text-(--d-down-text)"
          }
        >
          {stale ? "Stale data" : "Outage"}
        </span>
        {inc.title}
      </h4>
      <p className="mt-[3px] mb-0 text-[13.5px] text-muted">
        Started {fmtTime(inc.startedAt)}.{" "}
        {inc.endedAt ? (
          <>
            <span className="font-medium text-(--d-up-text)">Resolved</span> at {fmtTime(inc.endedAt)} after{" "}
            {fmtDur(inc.durationS)}.
          </>
        ) : (
          "Ongoing."
        )}
      </p>
      {inc.notes && <p className="mt-[3px] mb-0 text-[13.5px] text-muted">{inc.notes}</p>}
    </li>
  );
}
