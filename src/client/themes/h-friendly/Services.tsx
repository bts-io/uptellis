import type { ReactNode } from "react";
import { BeatBar } from "@/client/kit";
import type { DisplayState, ServiceView, SiteView } from "@/shared/view";
import { cx, daysCaption, every, KIND, pct, plural, WORD } from "./format";
import { BlockHead, CARD, Pill } from "./ui";

/** The kit's 90-day bar as a row of soft rounded days in the pills' dot colours, 2px apart. */
const DAYS = cx(
  "[&>[role=img]]:gap-0.5 [&_[data-worst]]:rounded-full [&_[data-worst]]:opacity-100",
  "[&_[data-worst=up]]:bg-(--h-up-dot)",
  "[&_[data-worst=degraded]]:bg-(--h-warn-dot) [&_[data-worst=pending]]:bg-(--h-warn-dot)",
  "[&_[data-worst=down]]:bg-(--h-down-dot)",
  "[&_[data-worst=maintenance]]:bg-(--h-maint-dot)",
  "[&_[data-worst=paused]]:bg-(--h-idle-dot) [&_[data-worst=unknown]]:bg-(--h-idle-dot)",
  "[&_[data-worst=none]]:border-0 [&_[data-worst=none]]:bg-(--h-none-dot)",
);

/** A "+ Technical details" disclosure with a label/value list in a warm well. */
export function Tech({
  summary,
  rows,
  className,
}: {
  summary: string;
  rows: { k: string; v: ReactNode; mono?: boolean; level?: string }[];
  className?: string;
}) {
  return (
    <details className={cx("group/tech mt-[0.45rem]", className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-[0.3rem] rounded-full text-[0.85rem] font-bold text-accent focus-visible:outline-3 focus-visible:outline-offset-[3px] focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden="true"
          className="inline-grid size-[1.1rem] place-items-center rounded-full bg-(--h-plus) text-[0.85rem] leading-none"
        >
          <span className="group-open/tech:hidden">+</span>
          <span className="hidden group-open/tech:inline">{"−"}</span>
        </span>
        {summary}
      </summary>
      <dl className="m-0 mt-[0.6rem] mb-[0.2rem] grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-[0.2rem] rounded-[14px] bg-(--h-well) px-4 py-[0.8rem] text-left text-[0.88rem]">
        {rows.map((r) => (
          <div key={r.k} className="contents">
            <dt className="text-muted">{r.k}</dt>
            <dd className={cx("m-0 [overflow-wrap:anywhere]", r.mono && "font-mono text-[0.9em]", r.level)}>
              {r.v}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function techRows(s: ServiceView) {
  const rows: { k: string; v: string; mono?: boolean }[] = [];
  const row = (k: string, v: string | null, mono?: boolean) => {
    if (v !== null && v !== "") rows.push({ k, v, mono });
  };
  row("Type of check", KIND[s.kind]);
  row("Checks", s.targetDisplay, true);
  row("Method", s.method, true);
  row("Response time", s.latencyMs !== null ? `${s.latencyMs} ms` : "no answer", true);
  row("Usual response", s.avgLatencyMs !== null ? `${Math.round(s.avgLatencyMs)} ms` : null, true);
  row("Up, last 24 hours", pct(s.uptime24h));
  row("Up, last 30 days", pct(s.uptime30d));
  row("Checked every", every(s.intervalS));
  if (s.cert)
    row(
      "Security certificate",
      s.cert.valid
        ? `Valid for ${plural(s.cert.daysRemaining, "more day")}${s.cert.issuer ? ` (${s.cert.issuer})` : ""}`
        : "Not valid",
    );
  if (s.health.score !== null)
    row(
      "Health score",
      `${Math.round(s.health.score)} of 100${s.health.reasons.length ? `: ${s.health.reasons.join(", ")}` : ""}`,
    );
  if (s.state === "stale") row("Last reported", WORD[s.status]);
  return rows;
}

function Service({ service: s }: { service: ServiceView }) {
  const stale = s.state === "stale";
  const cap = daysCaption(s);
  return (
    <li
      id={`svc-${s.id}`}
      tabIndex={-1}
      data-state={s.state}
      className="border-t-2 border-line py-[0.85rem] outline-offset-4 focus-visible:rounded-lg focus-visible:outline-3 focus-visible:outline-accent"
    >
      <div className="flex flex-wrap items-center justify-between gap-[0.6rem]">
        <span className="min-w-0 font-bold [overflow-wrap:anywhere]">{s.name}</span>
        <Pill state={s.state} />
      </div>
      <div className={cx("mt-[0.6rem] mb-[0.3rem]", stale && "opacity-70 grayscale-[0.7]")}>
        <BeatBar days={s.beats90d} text={s.beatsText} height={20} className={DAYS} />
      </div>
      <span className="sr-only">Last 90 days: {cap}</span>
      <div aria-hidden="true" className="flex flex-wrap justify-between gap-2 text-[0.8rem] text-muted">
        <span>90 days ago</span>
        <span>{cap}</span>
        <span>Today</span>
      </div>
      <Tech summary="Technical details" rows={techRows(s)} />
    </li>
  );
}

/** "How everything is doing": a rounded card per section (and "Everything else"), two across on wide screens. */
export function Groups({ view }: { view: SiteView }) {
  const groups = view.sections.map((s) => ({
    id: s.id,
    title: s.title,
    state: s.state as DisplayState | null,
    services: s.services,
  }));
  if (view.unsectioned.length)
    groups.push({ id: "other", title: "Everything else", state: null, services: view.unsectioned });
  return (
    <section id="services" className="mt-9" aria-labelledby="h-svc">
      <BlockHead id="h-svc" aside={`${view.summary.up} of ${view.summary.total} working`}>
        How everything is doing
      </BlockHead>
      {groups.length ? (
        <div className="grid grid-cols-2 gap-[1.1rem] max-[760px]:grid-cols-1">
          {groups.map((g) => (
            <section
              key={g.id}
              aria-labelledby={`h-g-${g.id}`}
              className={cx(CARD, "min-w-0 px-[1.3rem] pt-[1.2rem] pb-[0.6rem]")}
            >
              <div className="mb-[0.4rem] flex items-center justify-between gap-[0.6rem]">
                <h3 id={`h-g-${g.id}`} className="m-0 text-[1.15rem] font-extrabold">
                  {g.title}
                </h3>
                {g.state && <Pill state={g.state} />}
              </div>
              <ul className="m-0 list-none p-0">
                {g.services.map((s) => (
                  <Service key={s.id} service={s} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className={cx(CARD, "m-0 px-[1.4rem] py-[1.2rem] text-(--h-ink-2)")}>Nothing to check here yet.</p>
      )}
    </section>
  );
}
