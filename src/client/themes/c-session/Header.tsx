import { Age, Banner, StaleBanner, StateDot } from "@/client/kit";
import type { SiteView, VerdictState } from "@/shared/view";
import { allServices, cx, failing, isoBefore } from "./format";

const VERDICT_TEXT: Record<VerdictState, string> = {
  operational: "text-up",
  degraded: "text-degraded",
  outage: "text-down",
  maintenance: "text-maint",
  stale: "text-down",
  empty: "text-muted",
};

/** Title bar, banner, title, verdict and freshness; the stale strip under it while the collector is quiet. */
export function Header({ view }: { view: SiteView }) {
  const { freshness } = view;
  const since = isoBefore(view.now, freshness.ageS ?? 0);
  const names = allServices(view)
    .filter(failing)
    .map((s) => s.name);
  // Under maintenance a quiet collector is expected: the verdict says so instead of the stale age.
  const verdict =
    freshness.state === "stale" && view.verdict.state !== "maintenance" ? (
      <>
        stale · <Age since={since} now={view.now} suffix={false} />
      </>
    ) : names.length && view.verdict.state !== "empty" ? (
      `${view.verdict.label}: ${names.join(", ")}`
    ) : (
      view.verdict.label
    );

  return (
    <>
      <div className="flex h-[38px] items-center gap-2 border-b border-line bg-(--c-titlebar) px-4">
        {["bg-(--c-win-close)", "bg-(--c-win-min)", "bg-(--c-win-max)"].map((c) => (
          <i key={c} aria-hidden="true" className={cx("block size-[11px] rounded-full opacity-85", c)} />
        ))}
        {/* Window chrome: repeats the slug and the h1 below, so it is hidden from assistive technology. */}
        <p
          aria-hidden="true"
          className="m-0 mr-[52px] flex-1 truncate text-center font-mono text-xs leading-none tracking-[0.02em] text-muted"
        >
          {view.site.slug.toUpperCase()} · Services Status
        </p>
      </div>

      <header className="relative overflow-hidden px-4 pt-[22px] pb-[18px] after:pointer-events-none after:absolute after:inset-0 after:bg-[repeating-linear-gradient(180deg,var(--c-scan)_0_1px,transparent_1px_3px)] after:content-[''] md:px-7 md:pt-[30px] md:pb-[22px]">
        <div className="flex flex-col items-start gap-4 md:flex-row md:items-end md:justify-between md:gap-8">
          <div className="[&>[role=img]]:text-[13px] md:[&>[role=img]]:text-[19px]">
            <Banner text={view.site.slug.toUpperCase()} decrypt />
          </div>
          <div className="min-w-0 md:text-right">
            <h1 className="m-0 w-max text-gradient-brand font-mono text-lg leading-[1.1] font-semibold tracking-[-0.01em] md:ml-auto md:text-[22px]">
              [ Services Status ]
            </h1>
            <p className="mt-1.5 mb-0 font-sans text-[13px] leading-[1.4] text-muted">
              {view.branding.tagline ?? view.site.name}
            </p>
            <p
              role="status"
              data-state={view.verdict.state}
              className={cx(
                "mt-3.5 mb-0 font-mono text-xs leading-none font-semibold tracking-[0.08em] uppercase",
                VERDICT_TEXT[view.verdict.state],
              )}
            >
              {verdict}
            </p>
            <p className="mt-2 mb-0 flex items-center gap-2 font-mono text-xs leading-none text-muted md:justify-end">
              {freshness.state === "fresh" && (
                <>
                  <StateDot state={view.verdict.state === "outage" ? "down" : "up"} pulse label="live" />
                  <span>
                    live · updated <Age since={since} now={view.now} />
                  </span>
                </>
              )}
              {freshness.state === "aging" && (
                <>
                  <StateDot state="degraded" label="aging" />
                  <span>
                    <span className="text-degraded">aging</span> · updated{" "}
                    <Age since={since} now={view.now} />
                  </span>
                </>
              )}
              {freshness.state === "stale" && (
                <>
                  <StateDot state="stale" />
                  <span className="text-down">
                    no snapshot for <Age since={since} now={view.now} suffix={false} />
                  </span>
                </>
              )}
              {freshness.state === "empty" && (
                <>
                  <StateDot state="unknown" label="no data" />
                  <span>no source has reported</span>
                </>
              )}
            </p>
          </div>
        </div>
      </header>

      {(freshness.state === "stale" || freshness.state === "empty") && (
        <div className="border-y border-stale/35 bg-[repeating-linear-gradient(135deg,color-mix(in_oklab,var(--color-stale)_10%,transparent)_0_8px,color-mix(in_oklab,var(--color-stale)_4%,transparent)_8px_16px)] [&>[role=alert]]:border-0 [&>[role=alert]]:bg-transparent [&>[role=alert]]:px-4 md:[&>[role=alert]]:px-7">
          <StaleBanner freshness={freshness} now={view.now} generatedAt={view.generatedAt} />
        </div>
      )}
    </>
  );
}
