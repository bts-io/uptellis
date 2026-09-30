import { useAgeTicker } from "@/client/effects";
import type { SiteView } from "@/shared/view";
import { ago, alertPlan, clock, cx, isFresh, isoBefore, pct, silentSources } from "./format";
import { BoardIcon, Mark, verdictIcon } from "./icons";

/** Brand on the left (site name, tagline or host), the data's age on the right, ticking on the client. */
export function Top({ view }: { view: SiteView }) {
  const sub = view.branding.tagline ?? view.site.hostnames[0] ?? "";
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Mark className="size-10 flex-none text-ink" />
        <div className="min-w-0">
          <p className="text-[1.6rem] font-extrabold tracking-[0.01em] min-[900px]:text-[2rem]">
            {view.site.name}
          </p>
          {sub && <p className="text-[1.1rem] text-muted">{sub}</p>}
        </div>
      </div>
      <Fresh view={view} />
    </header>
  );
}

function Fresh({ view }: { view: SiteView }) {
  const f = view.freshness;
  const age = useAgeTicker(isoBefore(view.now, f.ageS ?? 0), view.now, 5000);
  const fresh = isFresh(view);
  const text =
    f.state === "empty"
      ? "No data received yet"
      : fresh
        ? `Updated ${ago(age)} ago`
        : `Stale: last data ${ago(age)} ago`;
  const line = (
    <p
      data-state={f.state}
      className={cx(
        "flex items-center gap-2 text-[1.15rem] font-semibold min-[900px]:text-[1.4rem]",
        fresh ? "text-muted" : "text-stale",
      )}
    >
      <span
        aria-hidden="true"
        className={cx("size-3 flex-none rounded-full", fresh ? "bg-up" : "bg-stale")}
      />
      {text}
    </p>
  );
  if (!alertPlan(view).staleInHeader) return line;
  // Incidents hold the alert rows, so on a wall the stale strip folds in here: its sources under the age.
  const silent = silentSources(view);
  const detail = `${silent.length ? `Not reporting: ${silent.join(", ")} · ` : ""}last snapshot ${clock(view.generatedAt)}`;
  return (
    <div data-stale-folded="" className="flex min-w-0 flex-col items-end gap-0.5">
      {line}
      <p title={detail} className="hidden max-w-full truncate text-[1.1rem] text-muted min-[900px]:block">
        {detail}
      </p>
    </div>
  );
}

const BAND: Record<SiteView["verdict"]["state"], { box: string; icon: string; counts: string }> = {
  operational: { box: "border-up bg-(--g-up-bg)", icon: "text-up", counts: "text-muted" },
  degraded: { box: "border-degraded bg-(--g-degraded-bg)", icon: "text-degraded", counts: "text-muted" },
  outage: {
    box: "border-(--g-down-edge) bg-(--g-down-fill)",
    icon: "text-(--g-on-down)",
    counts: "text-(--g-on-down)",
  },
  maintenance: { box: "border-maint bg-(--g-maint-bg)", icon: "text-maint", counts: "text-muted" },
  stale: {
    box: "border-dashed border-stale bg-[repeating-linear-gradient(135deg,var(--g-stale-bg)_0_1.25rem,var(--g-stale-bg-2)_1.25rem_2.5rem)]",
    icon: "text-stale",
    counts: "text-muted",
  },
  empty: {
    box: "border-(--g-unknown) bg-(--g-unknown-bg)",
    icon: "text-(--g-unknown)",
    counts: "text-muted",
  },
};

/** The verdict band: icon, `verdict.label` verbatim, and the counts in a line. */
export function Verdict({ view }: { view: SiteView }) {
  const { verdict: v, summary: s } = view;
  const parts: string[] = [];
  if (v.state === "stale") parts.push(`${s.total} services, states below are last known`);
  else {
    parts.push(`${s.up} of ${s.total} up`);
    if (s.down) parts.push(`${s.down} down`);
    if (s.degraded) parts.push(`${s.degraded} slow`);
    if (s.maintenance) parts.push(`${s.maintenance} in maintenance`);
  }
  if (s.uptime30d !== null) parts.push(`${pct(s.uptime30d)} uptime 30 days`);
  const band = BAND[v.state];
  return (
    <section
      aria-labelledby="g-verdict"
      data-state={v.state}
      className={cx(
        "flex flex-col items-start gap-3 rounded-2xl border-[0.2rem] px-[1.1rem] py-[1.1rem] min-[900px]:flex-row min-[900px]:items-center min-[900px]:gap-6 min-[900px]:px-7 min-[900px]:py-4",
        band.box,
      )}
    >
      <BoardIcon name={verdictIcon(v.state)} className={cx("size-14 min-[900px]:size-[5.5rem]", band.icon)} />
      <div className="min-w-0">
        <h1
          id="g-verdict"
          className="text-[2.6rem] leading-none font-extrabold tracking-[-0.01em] min-[900px]:text-[4rem] min-[1101px]:text-[4.75rem]"
        >
          {v.label}
        </h1>
        <p className={cx("mt-1.5 text-[1.2rem] font-semibold min-[900px]:text-[1.6rem]", band.counts)}>
          {parts.join(" · ")}
        </p>
      </div>
    </section>
  );
}
