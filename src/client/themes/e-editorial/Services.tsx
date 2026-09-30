import { BeatBar } from "@/client/kit";
import type { DisplayState, ServiceView, SiteView } from "@/shared/view";
import { barSummary, cx, pct, STATE_WORD } from "./format";
import { PartHead, StateTag } from "./ui";

/**
 * The kit's 90-day bar in the mock-up's tick colours: lighter than the state text, a plain paper-grey for
 * days without data, a 1px gap.
 */
const TICKS = cx(
  "[&>[role=img]]:gap-px",
  "[&_[data-worst=up]]:bg-(--e-tick-up) [&_[data-worst=up]]:opacity-100",
  "[&_[data-worst=degraded]]:bg-(--e-tick-degraded) [&_[data-worst=pending]]:bg-(--e-tick-degraded)",
  "[&_[data-worst=down]]:bg-(--e-tick-down)",
  "[&_[data-worst=maintenance]]:bg-(--e-tick-maintenance) [&_[data-worst=maintenance]]:opacity-100",
  "[&_[data-worst=paused]]:bg-(--e-tick-none) [&_[data-worst=unknown]]:bg-(--e-tick-none)",
  "[&_[data-worst=none]]:border-0 [&_[data-worst=none]]:bg-(--e-tick-none)",
);

function Bar({ service, stale }: { service: ServiceView; stale: boolean }) {
  return (
    <div className="min-w-0 max-[640px]:col-span-full max-[640px]:row-start-2">
      <div className={cx(stale && "opacity-55")}>
        <BeatBar days={service.beats90d} text={service.beatsText} height={18} className={TICKS} />
      </div>
      <span className="sr-only">{barSummary(service)}</span>
      <div aria-hidden="true" className="mt-[0.15rem] flex justify-between text-[0.66rem] text-muted">
        <span>90 days ago</span>
        <span>today</span>
      </div>
    </div>
  );
}

function ServiceRow({ service: s }: { service: ServiceView }) {
  const stale = s.state === "stale";
  const detail = s.targetDisplay !== null || s.latencyMs !== null;
  return (
    <li
      id={`svc-${s.id}`}
      tabIndex={-1}
      data-state={s.state}
      className="grid grid-cols-[minmax(0,1fr)_13.5rem_4.2rem_7.8rem] items-center gap-x-4 gap-y-1 border-b border-dotted border-(--e-rule) py-[0.7rem] outline-offset-4 focus-visible:outline-2 focus-visible:outline-ink max-[640px]:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="min-w-0 font-(family-name:--e-serif) text-[1.05rem] max-[640px]:col-start-1 max-[640px]:row-start-1">
        {s.name}
        {detail && (
          <small className="block font-sans text-[0.75rem] [overflow-wrap:anywhere] text-muted">
            {s.targetDisplay}
            {s.targetDisplay && s.latencyMs !== null && " · "}
            {s.latencyMs !== null && <span className="font-mono text-[0.85em]">{s.latencyMs} ms</span>}
          </small>
        )}
      </div>
      <Bar service={s} stale={stale} />
      <div className="text-right text-(--e-ink-2) tabular-nums max-[640px]:col-span-full max-[640px]:row-start-3 max-[640px]:text-left">
        {pct(s.uptime30d)}
        <small className="block text-[0.7rem] text-muted max-[640px]:ml-[0.3rem] max-[640px]:inline">
          30 days
        </small>
      </div>
      <StateTag state={s.state} className="justify-self-end max-[640px]:col-start-2 max-[640px]:row-start-1">
        {stale && (
          <small className="font-medium tracking-normal text-muted normal-case">
            {" "}
            (last seen {STATE_WORD[s.status].toLowerCase()})
          </small>
        )}
      </StateTag>
    </li>
  );
}

function Desk({
  id,
  title,
  state,
  services,
}: {
  id: string;
  title: string;
  state: DisplayState | null;
  services: ServiceView[];
}) {
  return (
    <div className="mt-[1.9rem]">
      <h3
        id={id}
        className="m-0 mb-1 flex items-baseline justify-between gap-4 font-(family-name:--e-serif-display) text-[1.25rem] font-semibold"
      >
        {title}
        {state && <StateTag state={state} className="text-[0.72rem]" />}
      </h3>
      <ul aria-labelledby={id} className="m-0 list-none p-0 font-sans text-[0.92rem]">
        {services.map((s) => (
          <ServiceRow key={s.id} service={s} />
        ))}
      </ul>
    </div>
  );
}

/** "The services": one desk per section (and "Other" for services in none), a row per service. */
export function Services({ view }: { view: SiteView }) {
  const groups = view.sections.map((s) => ({
    id: s.id,
    title: s.title,
    state: s.state as DisplayState | null,
    services: s.services,
  }));
  if (view.unsectioned.length)
    groups.push({ id: "other", title: "Other", state: null, services: view.unsectioned });
  return (
    <section id="services" className="pt-10" aria-labelledby="e-h-svc">
      <PartHead
        id="e-h-svc"
        title="The services"
        aside={`${view.summary.up} of ${view.summary.total} operational`}
      />
      {groups.length ? (
        groups.map((g) => <Desk key={g.id} {...g} id={`e-desk-${g.id}`} />)
      ) : (
        <p className="m-0 mt-4 text-muted italic">No services on this page yet.</p>
      )}
    </section>
  );
}
