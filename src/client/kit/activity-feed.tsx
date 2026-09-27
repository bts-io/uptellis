import type { CSSProperties } from "react";
import type { ActivityItem } from "@/shared/view";
import { Age } from "./age";
import { cx } from "./cx";
import { utcTime } from "./format";
import type { ActivityFeedProps } from "./props";
import { BORDER, LEVEL_TONE, stateTone, TEXT, type Tone } from "./tone";

/** Short tag for a row: the status for transitions, the event for incidents and sources. */
export function activityTag(item: ActivityItem): string {
  if (item.kind === "incident-open") return "OPEN";
  if (item.kind === "incident-resolved") return "FIXED";
  if (item.kind === "source") return item.level === "ok" ? "BACK" : "STALE";
  return item.level === "ok"
    ? "UP"
    : item.level === "crit"
      ? "DOWN"
      : item.level === "warn"
        ? "WARN"
        : "INFO";
}

/** Event rows are tinted in their level colour so they stand out from the plain check rows after them. */
const EVENT_BG: Record<Tone, string> = {
  up: "bg-up/6",
  degraded: "bg-degraded/8",
  down: "bg-down/8",
  maint: "bg-maint/8",
  stale: "bg-stale/8",
  muted: "bg-ink/[0.03]",
};

const ROW =
  "grid grid-cols-[62px_48px_minmax(0,1fr)_80px] items-center gap-2 border-l-2 px-2 py-[5px] md:grid-cols-[70px_50px_minmax(0,150px)_minmax(0,1fr)_88px] md:gap-3 md:px-2.5";

/**
 * Activity rows, newest first: UTC time, tag, title, message and a ticking relative time, each with a 2px
 * rule in its level colour and tinted. `checks` follow the events in the same design: status, service,
 * check message and latency, only failures tinted. With `columns={2}` the list fills the left column first
 * from the md breakpoint up.
 */
export function ActivityFeed({ items, now, limit, columns = 1, checks = [] }: ActivityFeedProps) {
  const events = limit === undefined ? items : items.slice(0, limit);
  const beats = limit === undefined ? checks : checks.slice(0, Math.max(0, limit - events.length));
  const count = events.length + beats.length;
  if (count === 0) return <p className="m-0 font-mono text-xs text-muted">No activity yet.</p>;
  const style = { "--kit-rows": `repeat(${Math.ceil(count / 2)}, auto)` } as CSSProperties;
  return (
    <ol
      style={columns === 2 ? style : undefined}
      className={cx(
        "m-0 grid list-none grid-cols-1 gap-y-0.5 p-0 font-mono text-[12.5px]",
        columns === 2 && "md:grid-flow-col md:grid-cols-2 md:grid-rows-(--kit-rows) md:gap-x-7",
      )}
    >
      {events.map((item) => {
        const tone = LEVEL_TONE[item.level];
        return (
          <li key={item.id} data-level={item.level} className={cx(ROW, BORDER[tone], EVENT_BG[tone])}>
            <time dateTime={item.ts} className="text-muted">
              {utcTime(item.ts)}
            </time>
            <span className={cx("text-[11.5px] font-bold tracking-[0.06em]", TEXT[tone])}>
              {activityTag(item)}
            </span>
            <span className="truncate text-ink">{item.title}</span>
            <span className="hidden truncate text-muted md:block">{item.message ?? ""}</span>
            <span className="whitespace-nowrap text-right text-muted">
              <Age since={item.ts} now={now} />
            </span>
          </li>
        );
      })}
      {beats.map(({ id, service, beat }) => {
        const tone = stateTone(beat.status);
        return (
          <li
            key={`${id}-${beat.ts}`}
            data-check={id}
            data-state={beat.status}
            className={cx(ROW, BORDER[tone], beat.status === "down" ? "bg-down/8" : "odd:bg-ink/[0.015]")}
          >
            <time dateTime={beat.ts} className="text-muted">
              {utcTime(beat.ts)}
            </time>
            <span className={cx("text-[11.5px] font-bold tracking-[0.06em] uppercase", TEXT[tone])}>
              {beat.status}
            </span>
            <span className="truncate text-ink">{service}</span>
            <span className="hidden truncate text-muted md:block">{beat.message ?? ""}</span>
            <span className="whitespace-nowrap text-right">
              {beat.latencyMs !== null ? (
                <>
                  {beat.latencyMs} <span className="text-muted">ms</span>
                </>
              ) : beat.status === "down" ? (
                <span className="text-down">timeout</span>
              ) : (
                <span className="text-muted">-</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
