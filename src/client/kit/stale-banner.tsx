import { useAgeTicker } from "@/client/effects";
import { fmtAge, isoBefore, utcTime } from "./format";
import type { StaleBannerProps } from "./props";

/**
 * Full-width alert while the data is stale or no source has reported; renders nothing otherwise. The visible
 * age ticks; screen readers get the age at render time once, not an announcement every second.
 */
export function StaleBanner({ freshness, now, generatedAt }: StaleBannerProps) {
  const { state, ageS } = freshness;
  const age = useAgeTicker(isoBefore(now, ageS ?? 0), now);
  if (state !== "stale" && state !== "empty") return null;
  const box =
    "flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border border-stale/55 bg-stale/12 px-4 py-2.5 font-mono text-xs font-semibold text-stale md:text-[12.5px]";
  if (state === "empty") {
    return (
      <div role="alert" data-state={state} className={box}>
        <span>NO DATA YET: no source has reported</span>
      </div>
    );
  }
  const from = `showing data from ${utcTime(generatedAt)} UTC`;
  return (
    <div role="alert" data-state={state} className={box}>
      <span className="sr-only">
        Snapshot stale: last collector report {fmtAge(ageS ?? 0)} ago, {from}
      </span>
      <span aria-hidden="true">SNAPSHOT STALE: last collector report {fmtAge(age)} ago</span>
      <span
        aria-hidden="true"
        className="font-medium text-[color-mix(in_oklab,var(--color-stale)_55%,var(--color-ink))]"
      >
        {from}
      </span>
    </div>
  );
}
