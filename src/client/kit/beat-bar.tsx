import { type KeyboardEvent, useId, useState } from "react";
import type { BeatDay } from "@/shared/view";
import { cx } from "./cx";
import { fmtMinutes, fmtRatio } from "./format";
import type { BeatBarProps } from "./props";

const CELL: Record<string, string> = {
  up: "bg-up opacity-80",
  degraded: "bg-degraded",
  pending: "bg-degraded",
  down: "bg-down",
  maintenance: "bg-maint opacity-80",
  paused: "bg-faint opacity-35",
  unknown: "bg-faint opacity-35",
};
const NO_DATA = "border border-faint/50 bg-hatch text-faint";

/** One line per day for the tooltip and the screen-reader announcement. */
export function beatDayText(d: BeatDay): string {
  if (d.worst === null) return `${d.day}: no data`;
  const parts: string[] = [d.worst];
  if (d.uptime !== null) parts.push(fmtRatio(d.uptime));
  parts.push(d.minutesDown > 0 ? `down ${fmtMinutes(d.minutesDown)}` : "no downtime");
  return `${d.day}: ${parts.join(" · ")}`;
}

/**
 * 90 daily cells, oldest first, coloured by the day's worst state; days without data are hatched. The bar is
 * one tab stop whose accessible name is the `+~x=.` text form (also the copy payload); hover or the arrow
 * keys pick a day and show its tooltip, which is announced politely. Tooltip placement uses percentages, so
 * nothing is measured and the server markup is stable.
 */
export function BeatBar({ days, text, height = 18, className }: BeatBarProps) {
  const [active, setActive] = useState<number | null>(null);
  const tipId = useId();
  const n = days.length;
  const day = active === null ? undefined : days[active];

  const onKeyDown = (e: KeyboardEvent) => {
    const last = n - 1;
    const cur = active ?? last;
    const next =
      e.key === "ArrowLeft"
        ? Math.max(0, cur - 1)
        : e.key === "ArrowRight"
          ? Math.min(last, cur + 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? last
              : null;
    if (e.key === "Escape") setActive(null);
    if (next === null) return;
    e.preventDefault();
    setActive(next);
  };

  return (
    <div className={cx("relative", className)}>
      <div
        role="img"
        aria-label={text}
        aria-describedby={day ? tipId : undefined}
        tabIndex={0}
        data-copy={text}
        onCopy={(e) => {
          e.clipboardData.setData("text/plain", text);
          e.preventDefault();
        }}
        onKeyDown={onKeyDown}
        onFocus={() => setActive((a) => a ?? n - 1)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        className="grid cursor-crosshair gap-px md:gap-0.5"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, height }}
      >
        {days.map((d, i) => (
          <span
            key={d.day}
            data-worst={d.worst ?? "none"}
            onMouseEnter={() => setActive(i)}
            className={cx(
              "rounded-[1px] hover:opacity-100 motion-safe:transition-transform",
              d.worst === null ? NO_DATA : CELL[d.worst],
              i === active && "scale-y-[1.18] opacity-100",
            )}
          />
        ))}
      </div>
      {day && active !== null && (
        <div
          id={tipId}
          role="tooltip"
          className={cx(
            "pointer-events-none absolute bottom-full z-50 mb-2 whitespace-nowrap border border-hair bg-raised px-2.5 py-1.5 font-mono text-[11.5px] leading-normal text-ink shadow-[0_10px_30px_-10px_rgb(0_0_0/0.6)]",
            active < n * 0.15 ? "" : active > n * 0.85 ? "-translate-x-full" : "-translate-x-1/2",
          )}
          style={{ left: `${((active + 0.5) / n) * 100}%` }}
        >
          {beatDayText(day)}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {day ? beatDayText(day) : ""}
      </span>
    </div>
  );
}
