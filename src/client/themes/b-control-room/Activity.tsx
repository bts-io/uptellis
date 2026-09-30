import type { ServiceView, SiteView } from "@/shared/view";
import { allServices, checkType, cx, DASH, hhmmss, kumaStale } from "./format";
import { Chip, Micro, Tile } from "./ui";

/** Rows in the activity tile: the newest checks across every monitor. */
const ROWS = 12;

const RULE: Record<string, string> = {
  up: "bg-up",
  down: "bg-down",
  degraded: "bg-degraded",
  pending: "bg-degraded",
  maintenance: "bg-maint",
};

/** The newest checks across every monitor, newest first, one levelled row each. */
export function ActivityTile({ view, className }: { view: SiteView; className?: string }) {
  const rows = allServices(view)
    .flatMap((s) => s.recent.map((beat) => ({ s, beat })))
    .sort((a, b) => b.beat.ts.localeCompare(a.beat.ts))
    .slice(0, ROWS);

  return (
    <Tile aria-label="Recent activity" stale={kumaStale(view)} className={cx("overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-2.5 px-4 pt-3.5 pb-3">
        <div className="flex items-center gap-3">
          <Micro>Recent activity</Micro>
          <span className="font-mono text-[11.5px] whitespace-nowrap text-muted">
            last {rows.length}
            <span className="hidden sm:inline"> checks · all monitors</span> · UTC
          </span>
        </div>
      </div>
      {rows.length ? (
        <ul className="m-0 list-none p-0">
          {rows.map(({ s, beat }) => (
            <Row key={`${s.id}-${beat.ts}`} service={s} beat={beat} />
          ))}
        </ul>
      ) : (
        <p className="px-4 pb-4 text-[13px] text-muted">
          No checks yet. They show here as the collector reports.
        </p>
      )}
    </Tile>
  );
}

function Row({ service: s, beat }: { service: ServiceView; beat: ServiceView["recent"][number] }) {
  const down = beat.status === "down";
  return (
    <li
      data-check={beat.status}
      className={cx(
        "grid grid-cols-[62px_3px_minmax(0,1fr)_54px] items-center gap-x-3 gap-y-[3px] border-t border-(--b-hair2) px-4 py-[9px] font-mono text-xs md:h-9 md:grid-cols-[84px_3px_58px_minmax(0,190px)_minmax(0,1fr)_64px] md:py-0",
        down &&
          "bg-[linear-gradient(90deg,color-mix(in_oklab,var(--color-down)_10%,transparent),color-mix(in_oklab,var(--color-down)_2%,transparent))]",
      )}
    >
      <span className="row-span-2 self-start pt-px text-muted md:row-span-1 md:self-center md:pt-0">
        {hhmmss(beat.ts)}
      </span>
      <span
        className={cx("row-span-2 h-full rounded-xs md:row-span-1 md:h-5", RULE[beat.status] ?? "bg-faint")}
      />
      <span className="hidden md:inline">
        <Chip
          level={
            down ? "crit" : beat.status === "up" ? "ok" : beat.status === "maintenance" ? "maint" : "warn"
          }
        >
          {beat.status}
        </Chip>
      </span>
      <span className="truncate font-sans text-[13px] font-medium">{s.name}</span>
      <span className="col-span-2 col-start-3 truncate text-muted md:col-span-1 md:col-start-auto">
        <span className="mr-1.5 inline-block rounded bg-hair px-[5px] py-px text-[10px] tracking-[.04em] text-ink">
          {s.method ?? checkType(s)}
        </span>
        {s.targetDisplay ?? DASH} →{" "}
        <em className={cx("not-italic", down ? "text-down" : "text-ink")}>{beat.message ?? beat.status}</em>
      </span>
      <span className="col-start-4 row-start-1 text-right md:col-start-auto md:row-start-auto">
        {beat.latencyMs === null ? (
          <span className={down ? "text-down" : "text-muted"}>--</span>
        ) : (
          `${beat.latencyMs} ms`
        )}
      </span>
    </li>
  );
}
