import { useState } from "react";
import { BeatBar, Gauge, Panel, Sparkline, StateDot } from "@/client/kit";
import type { BeatView, ServiceView, TopologyView } from "@/shared/view";
import {
  checkType,
  cx,
  DASH,
  hhmm,
  hhmmss,
  LEVEL_TEXT,
  latencyLevel,
  pct,
  STATE_TEXT,
  stateLabel,
  uptimeLevel,
} from "./format";

type Node = TopologyView["nodes"][number];

const BEAT_CHAR_CLASS: Record<string, string> = {
  "+": "text-up",
  "~": "text-degraded",
  x: "text-down",
  "=": "text-maint",
  ".": "text-faint",
};

/** Beats shown in the collapsed phone row (the newest days). */
const MINI_BEATS = 22;
const RECENT_ROWS = 3;

export interface ServiceCardProps {
  service: ServiceView;
  /** The machine the check targets, when the topology knows it (for the host line). */
  node: Node | null;
  stale: boolean;
  /** Snapshot time, shown under frozen values. */
  generatedAt: string;
  defaultOpen: boolean;
}

/**
 * One monitor. On phones it collapses to a row (type, recent beats, latency) and expands on tap or Enter;
 * from 761px up the body is always shown.
 */
export function ServiceCard({ service: s, node, stale, generatedAt, defaultOpen }: ServiceCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const down = s.state === "down";
  const type = checkType(s);
  const toggle = () => {
    if (window.matchMedia("(max-width: 760px)").matches) setOpen((o) => !o);
  };

  return (
    <article
      id={`svc-${s.id}`}
      tabIndex={0}
      data-a-card=""
      aria-label={`${s.name}, ${stateLabel(s)}`}
      data-open={open}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) setOpen((o) => !o);
      }}
      className="outline-offset-2 focus-visible:outline-1 focus-visible:outline-accent max-[760px]:cursor-pointer"
    >
      <Panel
        title={s.name}
        level={down ? "crit" : undefined}
        className={cx(
          "[--kit-in:var(--color-raised)] [--kit-line:var(--a-line-card)] [--kit-out:var(--color-panel)]",
          stale && "border-dashed saturate-[.4]",
        )}
        aside={
          <span className="inline-flex items-center gap-1.5">
            <StateDot state={s.state} pulse={down} />
            <span className={cx("font-bold tracking-[.06em] uppercase", STATE_TEXT[s.state])}>
              {stateLabel(s)}
            </span>
          </span>
        }
      >
        <div
          className={cx("hidden items-center justify-between gap-2.5 text-xs", !open && "max-[760px]:flex")}
        >
          <span className="text-muted">{type}</span>
          <span aria-hidden="true" className="overflow-hidden font-bold tracking-[.5px] whitespace-nowrap">
            {[...s.beatsText.slice(-MINI_BEATS)].map((c, i) => (
              <span key={i} className={BEAT_CHAR_CLASS[c]}>
                {c}
              </span>
            ))}
          </span>
          <Latency service={s} small />
        </div>

        <div className={cx(!open && "max-[760px]:hidden")}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 text-xs text-muted">
              <div className="truncate">
                <span className="text-ink">{type}</span> {s.targetDisplay ?? DASH}
              </div>
              <div>
                {[
                  s.intervalS !== null && `every ${s.intervalS}s`,
                  s.timeoutS !== null && `timeout ${s.timeoutS}s`,
                ]
                  .filter(Boolean)
                  .join(" · ") || DASH}
              </div>
            </div>
            <div className="text-right">
              <Latency service={s} />
              {stale && (
                <div className="mt-1 text-[11px] whitespace-nowrap text-muted">as of {hhmm(generatedAt)}</div>
              )}
            </div>
          </div>

          <SparkBlock service={s} />

          <BeatBar days={s.beats90d} text={s.beatsText} height={20} className="mt-3" />
          <div className="mt-[5px] flex justify-between text-[10.5px] tracking-[.04em] text-faint">
            <span>90d ago</span>
            <span>30d {pct(s.uptime30d)}%</span>
            <span>today</span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-dashed border-hair pt-2.5 text-xs">
            <span>
              <span className="mr-1.5 text-muted">24h</span>
              {pct(s.uptime24h)}
            </span>
            <span>
              <span className="mr-1.5 text-muted">30d</span>
              <span className={s.uptime30d === null ? undefined : LEVEL_TEXT[uptimeLevel(s.uptime30d)]}>
                {pct(s.uptime30d)}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className="text-muted">health</span>
              <Gauge
                value={s.health.score}
                cells={10}
                level={s.health.level}
                label={`health ${s.health.score ?? DASH}`}
              />
              <span className={LEVEL_TEXT[s.health.level]}>
                {s.health.score === null ? DASH : Math.round(s.health.score)}
              </span>
            </span>
          </div>

          <HostLine service={s} node={node} />
          <RecentChecks service={s} stale={stale} />
        </div>
      </Panel>
    </article>
  );
}

function Latency({ service: s, small }: { service: ServiceView; small?: boolean }) {
  const size = small ? "text-[15px]" : "text-[22px]";
  if (s.latencyMs === null) {
    return (
      <span
        className={cx(size, "leading-none font-semibold", s.state === "down" ? "text-down" : "text-muted")}
      >
        {s.state === "down" ? "timeout" : DASH}
      </span>
    );
  }
  return (
    <span className={cx(size, "leading-none font-semibold tracking-[-.02em] whitespace-nowrap")}>
      <span className={s.state === "stale" ? "text-muted" : LEVEL_TEXT[latencyLevel(s.kind, s.latencyMs)]}>
        {s.latencyMs}
      </span>
      <small className="ml-[3px] text-xs font-normal tracking-normal text-muted">ms</small>
    </span>
  );
}

function SparkBlock({ service: s }: { service: ServiceView }) {
  if (s.spark.length < 2) return null;
  const lo = Math.round(Math.min(...s.spark));
  const hi = Math.round(Math.max(...s.spark));
  const range = `${lo} to ${hi} ms`;
  return (
    <div className="relative mt-3 pt-4">
      <span className="absolute top-0 left-0 text-[10.5px] tracking-[.06em] text-faint uppercase">
        latency · last {s.spark.length} checks
      </span>
      <span className="absolute top-0 right-0 text-[10.5px] tracking-[.06em] text-faint uppercase">
        {range}
      </span>
      <Sparkline
        points={s.spark}
        width={300}
        height={40}
        level={latencyLevel(s.kind, s.avgLatencyMs)}
        label={`latency ${range}`}
      />
    </div>
  );
}

function HostLine({ service: s, node }: { service: ServiceView; node: Node | null }) {
  if (s.cert) {
    const issuer = s.cert.issuer?.split(" ").pop();
    return (
      <div className="mt-1.5 truncate text-xs text-muted">
        <span className={LEVEL_TEXT[s.cert.level]}>
          {s.cert.valid ? `ssl valid ${s.cert.daysRemaining}d` : "ssl invalid"}
        </span>
        {[issuer, s.cert.cn].filter(Boolean).map((part) => ` · ${part}`)}
      </div>
    );
  }
  if (!node) return null;
  return (
    <div className="mt-1.5 truncate text-xs text-muted">
      host <span className="text-ink">{node.label}</span>
      {node.location && ` · ${node.location}`}
    </div>
  );
}

/** A check's status word, short enough for the status column ("maint" as in the summary line). */
const CHECK_WORD: Partial<Record<BeatView["status"], string>> = { maintenance: "maint" };

/**
 * The last checks: time, status, message and latency. "timeout" only for a down check without a latency;
 * a check with none for another reason (maintenance, paused) shows a dash.
 */
function RecentChecks({ service: s, stale }: { service: ServiceView; stale: boolean }) {
  const rows = s.recent.slice(0, RECENT_ROWS);
  if (!rows.length) return null;
  return (
    <ul aria-label="recent checks" className="mt-2 border-t border-dashed border-hair pt-2 text-[11.5px]">
      {rows.map((b) => (
        <li key={b.ts} className="grid grid-cols-[62px_64px_minmax(0,1fr)_auto] items-center gap-2">
          <span className="text-muted">{hhmmss(b.ts)}</span>
          <span
            className={cx(
              "font-bold tracking-[.06em] uppercase",
              stale ? "text-muted" : STATE_TEXT[b.status],
            )}
          >
            {CHECK_WORD[b.status] ?? b.status}
          </span>
          <span className="truncate text-muted">{b.message ?? DASH}</span>
          <span className="text-right">
            {b.latencyMs === null ? (
              b.status === "down" ? (
                <span className="text-down">timeout</span>
              ) : (
                <span className="text-muted">{DASH}</span>
              )
            ) : (
              <>
                {b.latencyMs} <span className="text-muted">ms</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
