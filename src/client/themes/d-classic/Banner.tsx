import type { SiteView, VerdictState } from "@/shared/view";
import { cx, plural } from "./format";
import { type IconName, LiveAge, StatusIcon } from "./ui";

const BAND: Record<VerdictState, string> = {
  operational: "bg-up",
  degraded: "bg-(--d-degraded-band)",
  outage: "bg-(--d-down-text)",
  stale: "bg-(--d-stale-text)",
  empty: "bg-(--d-stale-text)",
};

const ICON: Record<VerdictState, IconName> = {
  operational: "check",
  degraded: "warn",
  outage: "cross",
  stale: "clock",
  empty: "question",
};

/** The verdict band: `verdict.label` verbatim, with a line that says what is wrong and how old the data is. */
export function Banner({ view }: { view: SiteView }) {
  const { verdict } = view;
  return (
    <section
      role="status"
      aria-live="polite"
      data-state={verdict.state}
      className={cx(
        "flex items-center gap-3.5 rounded-lg px-[22px] py-[18px] text-(--d-on-band) shadow-[0_1px_2px_var(--d-shadow)] max-[600px]:gap-3 max-[600px]:p-4",
        BAND[verdict.state],
      )}
    >
      <StatusIcon name={ICON[verdict.state]} className="size-7" />
      <div className="min-w-0">
        <h2 className="m-0 text-xl font-semibold tracking-[-0.01em] max-[600px]:text-lg">{verdict.label}</h2>
        <p className="mt-0.5 mb-0 text-[13.5px] opacity-[.92]">
          <BannerLine view={view} />
        </p>
      </div>
    </section>
  );
}

function BannerLine({ view }: { view: SiteView }) {
  const { verdict, freshness, summary } = view;
  const age = freshness.ageS;
  if (verdict.state === "empty") return <>No monitoring data has been received yet.</>;
  if (verdict.state === "stale") {
    return (
      <>
        Last update received {age === null ? "never" : <LiveAge seconds={age} now={view.now} />}. The statuses
        below may no longer be accurate.
      </>
    );
  }
  const bits: string[] = [];
  if (verdict.down) bits.push(`${plural(verdict.down, "service is", "services are")} down`);
  if (verdict.degraded) bits.push(`${plural(verdict.degraded, "service is", "services are")} degraded`);
  if (!bits.length) bits.push(`${summary.up} of ${summary.total} services operational`);
  return (
    <>
      {bits.join(", ")}.
      {age !== null && (
        <>
          {" "}
          Updated <LiveAge seconds={age} now={view.now} />.
        </>
      )}
    </>
  );
}
