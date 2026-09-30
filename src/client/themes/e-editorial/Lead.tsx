import { useAgeTicker } from "@/client/effects";
import type { SiteView, VerdictState } from "@/shared/view";
import { allServices, clock, cx, isoBefore, KICKER, longDate, plural, shortDate, standfirst } from "./format";
import { AgeText } from "./ui";

/** Site name, "Status report · host" and the tagline over a double rule. */
export function Masthead({ view }: { view: SiteView }) {
  const name = view.branding.title || view.site.name;
  return (
    <>
      <header className="flex flex-wrap items-baseline justify-between gap-4 border-b-[3px] border-double border-(--e-rule-strong) pt-7 pb-[0.9rem]">
        <p className="m-0 font-(family-name:--e-serif-display) text-2xl font-semibold tracking-[-0.01em]">
          {name}
        </p>
        <span className="font-sans text-[0.78rem] tracking-[0.08em] text-muted uppercase">
          Status report · {view.site.hostnames[0] ?? view.site.slug}
        </span>
        {view.branding.tagline && (
          <p className="m-0 mt-[0.2rem] basis-full text-[0.95rem] text-(--e-ink-2) italic">
            {view.branding.tagline}
          </p>
        )}
      </header>
      {name !== view.site.name && (
        <p className="m-0 mt-2 font-sans text-[0.78rem] tracking-[0.08em] text-muted uppercase">
          {view.site.name}
        </p>
      )}
    </>
  );
}

const KICKER_TEXT: Record<VerdictState, string> = {
  operational: "text-up",
  degraded: "text-degraded",
  outage: "text-down",
  stale: "text-stale",
  empty: "text-stale",
};

/** The lead story: kicker, the verdict as a headline, a standfirst and the dateline. */
export function Lead({ view }: { view: SiteView }) {
  const { verdict, freshness } = view;
  // The standfirst's "last reported ... ago" keeps pace with the dateline on the client.
  const age = useAgeTicker(isoBefore(view.now, freshness.ageS ?? 0), view.now, 15_000);
  return (
    <article
      data-state={verdict.state}
      className="border-b border-(--e-rule) pt-12 pb-8 max-[640px]:pt-8 max-[640px]:pb-6"
    >
      <p
        className={cx(
          "m-0 mb-4 inline-flex items-center gap-2 font-sans text-[0.78rem] font-semibold tracking-[0.12em] uppercase",
          KICKER_TEXT[verdict.state],
        )}
      >
        <span aria-hidden="true" className="size-[0.6rem] rounded-full bg-current" />
        {KICKER[verdict.state]}
      </p>
      <h1 className="m-0 mb-5 font-(family-name:--e-serif-display) text-[clamp(2.5rem,7.2vw,4.4rem)] leading-[1.02] font-normal tracking-[-0.025em] text-balance [font-variation-settings:'opsz'_144] motion-safe:animate-[e-rise_0.5s_ease-out_both]">
        {verdict.label}.
      </h1>
      <p className="m-0 mb-5 max-w-[38rem] text-[1.3rem] leading-[1.5] text-(--e-ink-2) max-[640px]:text-[1.12rem] motion-safe:animate-[e-rise_0.5s_ease-out_0.08s_both]">
        {standfirst(view, freshness.ageS === null ? null : age)}
      </p>
      <p className="m-0 flex flex-wrap gap-x-[0.9rem] gap-y-1 font-sans text-[0.85rem] text-muted">
        <span>
          <strong className="font-semibold text-ink">{longDate(view.generatedAt)}</strong>,{" "}
          {clock(view.generatedAt)}
        </span>
        <span>
          Updated <AgeText ageS={freshness.ageS} now={view.now} />
        </span>
        <span>{plural(view.summary.total, "service")} watched</span>
      </p>
      {view.headline && (
        <p className="m-0 mt-6 border-l-2 border-(--e-rule) pl-4 text-(--e-ink-2) italic">{view.headline}.</p>
      )}
    </article>
  );
}

/** "This report is out of date" on a hatched amber box, while the data is late (not during site-wide maintenance). */
export function StaleNotice({ view }: { view: SiteView }) {
  const f = view.freshness;
  if (f.state === "fresh" || f.quietForMaintenance) return null;
  const stale = f.state === "stale" || f.state === "empty";
  return (
    <aside
      role="status"
      data-freshness={f.state}
      className="mt-8 border-2 border-degraded bg-[repeating-linear-gradient(135deg,var(--e-stale-a)_0_10px,var(--e-stale-b)_10px_20px)] px-5 py-[1.1rem]"
    >
      <h2 className="m-0 mb-[0.35rem] font-sans text-[0.8rem] tracking-[0.12em] text-degraded uppercase">
        {stale ? "This report is out of date" : "Reports are running late"}
      </h2>
      <p className="m-0 text-ink">
        The{" "}
        {f.state === "empty" ? (
          "monitors have not reported yet"
        ) : (
          <>
            stalest source{f.stalestSourceId ? ` (${f.stalestSourceId})` : ""} last reported{" "}
            <AgeText ageS={f.ageS} now={view.now} />
          </>
        )}
        .{" "}
        {stale
          ? "Every state below is the last one we heard, shown as Stale until fresh data arrives."
          : "The picture below may lag slightly."}
      </p>
    </aside>
  );
}

/** One boxed notice per active maintenance window: what, from when to when, and what it covers. */
export function MaintenanceNotices({ view }: { view: SiteView }) {
  const windows = view.maintenance ?? [];
  if (!windows.length) return null;
  const services = allServices(view);
  return (
    <>
      {windows.map((m) => {
        const covered = m.services.length
          ? services
              .filter((s) => m.services.includes(s.id))
              .map((s) => s.name)
              .join(", ") || "some services"
          : "every service";
        return (
          <aside
            key={m.id}
            role="status"
            data-maintenance=""
            className="mt-8 border border-maint bg-panel px-5 py-[1.1rem]"
          >
            <h2 className="m-0 mb-[0.35rem] font-sans text-[0.8rem] tracking-[0.12em] text-maint uppercase">
              Planned maintenance
            </h2>
            <p className="m-0">
              <strong>{m.title}.</strong> From {shortDate(m.start)}, {clock(m.start)} to {shortDate(m.end)},{" "}
              {clock(m.end)}, covering {covered}.
            </p>
          </aside>
        );
      })}
    </>
  );
}
