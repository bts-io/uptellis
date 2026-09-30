import type { BeatDay, DisplayState, ServiceView, SiteView } from "@/shared/view";
import { cx, fmtPct, plural, tickTitle, uptime90, worstState } from "./format";
import { BlockHead, GroupCard, GroupHead, StateTag } from "./ui";

/** Sections as bordered groups, one row per service with its 90-day tick bar, then the legend. */
export function Services({ view }: { view: SiteView }) {
  const empty = !view.sections.some((s) => s.services.length) && !view.unsectioned.length;
  return (
    <section aria-labelledby="d-h-svc" className="mt-9 max-[600px]:mt-7">
      <BlockHead id="d-h-svc" title="Services" aside="Uptime over the past 90 days" />
      {view.sections.map((s) => (
        <Group key={s.id} id={s.id} title={s.title} state={s.state} services={s.services} />
      ))}
      {view.unsectioned.length > 0 && (
        <Group
          id="other"
          title="Other services"
          state={worstState(view.unsectioned)}
          services={view.unsectioned}
        />
      )}
      {empty ? <p className="m-0 text-sm text-muted">No services are monitored yet.</p> : <Legend />}
    </section>
  );
}

function Group({
  id,
  title,
  state,
  services,
}: {
  id: string;
  title: string;
  state: DisplayState;
  services: ServiceView[];
}) {
  if (!services.length) return null;
  const headId = `d-g-${id}`;
  return (
    <GroupCard labelledBy={headId}>
      <GroupHead>
        <h3 id={headId} className="m-0 text-[15px] font-semibold">
          {title}
        </h3>
        <StateTag state={state} />
      </GroupHead>
      <ul className="m-0 list-none p-0">
        {services.map((s) => (
          <Service key={s.id} service={s} />
        ))}
      </ul>
    </GroupCard>
  );
}

function Service({ service: s }: { service: ServiceView }) {
  const showLatency = s.latencyMs !== null && s.state !== "stale" && s.state !== "down";
  return (
    <li
      id={`svc-${s.id}`}
      className="scroll-mt-4 px-5 pt-4 pb-3.5 not-first:border-t not-first:border-line max-[600px]:px-3.5"
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <span className="min-w-0 text-[15px] font-medium [overflow-wrap:anywhere]">
          {s.name}
          {showLatency && (
            <span title="Latest response time" className="ml-2 font-mono text-xs font-normal text-faint">
              {Math.round(s.latencyMs!)} ms
            </span>
          )}
        </span>
        <StateTag state={s.state} />
      </div>
      <Bar service={s} />
    </li>
  );
}

const TICK: Record<NonNullable<BeatDay["worst"]> | "none", string> = {
  up: "bg-up",
  degraded: "bg-degraded",
  pending: "bg-degraded",
  down: "bg-down",
  maintenance: "bg-maint",
  paused: "bg-(--d-paused)",
  unknown: "bg-(--d-paused)",
  none: "bg-(--d-nodata)",
};

/** 90 daily ticks, oldest first; every day stays visible on a phone (thinner ticks, 1 px gaps). */
function Bar({ service: s }: { service: ServiceView }) {
  const days = s.beats90d;
  const up = fmtPct(uptime90(days));
  const bad = days.filter((b) => b.worst === "down").length;
  const summary = `90-day history for ${s.name}: ${up ? `${up} uptime` : "no data"}${
    bad ? `, ${plural(bad, "day", "days")} with downtime` : ""
  }`;
  return (
    <>
      <div
        role="img"
        aria-label={summary}
        data-beats={s.beatsText}
        className="flex h-[30px] items-stretch gap-[2px] max-[600px]:h-[26px] max-[600px]:gap-px"
      >
        {days.map((b) => (
          <span
            key={b.day}
            data-w={b.worst ?? "none"}
            title={tickTitle(b)}
            className={cx(
              "min-w-0 flex-[1_1_0] rounded-[2px] hover:opacity-70 max-[600px]:rounded-[1px]",
              TICK[b.worst ?? "none"],
            )}
          />
        ))}
      </div>
      <div aria-hidden="true" className="mt-1.5 flex items-center justify-between gap-3 text-xs text-faint">
        <span>90 days ago</span>
        <span className="h-px flex-1 bg-line" />
        <span className="font-medium text-muted">{up ? `${up} uptime` : "No data"}</span>
        <span className="h-px flex-1 bg-line" />
        <span>Today</span>
      </div>
    </>
  );
}

const LEGEND = [
  { swatch: "bg-up", label: "Operational" },
  { swatch: "bg-degraded", label: "Degraded" },
  { swatch: "bg-down", label: "Down" },
  { swatch: "bg-maint", label: "Maintenance" },
  { swatch: "bg-(--d-nodata)", label: "No data" },
];

function Legend() {
  return (
    <ul
      aria-label="History legend"
      className="m-0 mt-1 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 text-[12.5px] text-muted"
    >
      {LEGEND.map((l) => (
        <li key={l.label} className="inline-flex items-center gap-1.5">
          <i className={cx("inline-block size-2.5 rounded-[2px]", l.swatch)} />
          {l.label}
        </li>
      ))}
    </ul>
  );
}
