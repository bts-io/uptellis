import { useAgeTicker } from "@/client/effects";
import { cx } from "./cx";
import { fmtAge, isoBefore } from "./format";
import type { FreshnessChipProps } from "./props";
import { StateDot } from "./state-dot";

/** "live / updated 34s ago" chip; the age ticks forward on the client from `ageS` at `now`. */
export function FreshnessChip({ freshness, now }: FreshnessChipProps) {
  const { state, ageS } = freshness;
  const age = fmtAge(useAgeTicker(isoBefore(now, ageS ?? 0), now));
  return (
    <span
      data-state={state}
      className={cx(
        "inline-flex h-7 items-center gap-2 whitespace-nowrap border bg-panel/70 px-[11px] font-mono text-xs text-muted",
        state === "aging" ? "border-degraded/50" : state === "stale" ? "border-stale/50" : "border-hair",
      )}
    >
      {state === "fresh" && (
        <>
          <StateDot state="up" pulse label="live" />
          <b className="font-medium text-ink">live</b>
          <span>updated {age} ago</span>
        </>
      )}
      {state === "aging" && (
        <>
          <StateDot state="degraded" label="aging" />
          <b className="font-medium text-degraded">aging</b>
          <span>updated {age} ago</span>
        </>
      )}
      {state === "stale" && (
        <>
          <StateDot state="stale" />
          <b className="font-medium text-stale">stale</b>
          <span>last report {age} ago</span>
        </>
      )}
      {state === "empty" && (
        <>
          <StateDot state="unknown" label="no data" />
          <b className="font-medium text-ink">no data</b>
          <span>no source has reported</span>
        </>
      )}
    </span>
  );
}
