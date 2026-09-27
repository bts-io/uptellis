import { BeatBar, Sparkline, StateDot } from "@/client/kit";
import type { ServiceView } from "@/shared/view";
import { checkType, cx, DASH, hhmm, LEVEL_TEXT, latencyLevel, pct, quality } from "./format";
import { Chip, Tile } from "./ui";

/** One monitor: state, name, type and latency; target; latency sparkline; 90-day bar; uptimes and health. */
export function MonitorTile({
  service: s,
  stale,
  generatedAt,
}: {
  service: ServiceView;
  stale: boolean;
  /** Snapshot time, shown next to frozen values. */
  generatedAt: string;
}) {
  const down = s.state === "down";
  const q = quality(s.health.score);
  const every = s.intervalS === null ? null : `every ${s.intervalS}s`;
  const target = [s.method, s.targetDisplay].filter(Boolean).join(" ") || DASH;
  const lo = s.spark.length ? Math.round(Math.min(...s.spark)) : null;
  const hi = s.spark.length ? Math.round(Math.max(...s.spark)) : null;

  return (
    <Tile
      as="article"
      id={`svc-${s.id}`}
      tabIndex={0}
      data-b-card=""
      aria-label={`${s.name}, ${s.state === "stale" ? `last ${s.status}` : s.state}`}
      down={down}
      stale={stale}
      className="flex flex-col gap-2.5 px-4 pt-3.5 pb-[13px] outline-offset-2 transition-colors hover:border-(--b-hair3)"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <StateDot state={s.state} pulse={down} />
        <span className="truncate text-[14.5px] font-semibold tracking-[-.005em]">{s.name}</span>
        <Chip>{checkType(s)}</Chip>
        <span className="ml-auto font-mono text-[15px] font-medium whitespace-nowrap">
          {s.latencyMs === null ? (
            <span className={down ? "text-down" : "text-muted"}>{down ? "timeout" : DASH}</span>
          ) : (
            <>
              {s.latencyMs}
              <small className="ml-0.5 text-[11px] text-muted">ms</small>
            </>
          )}
          {stale && (
            <span className="ml-1.5 text-[10.5px] font-normal text-degraded">@{hhmm(generatedAt)}</span>
          )}
        </span>
      </div>

      <div className="truncate font-mono text-[11.5px] text-muted">
        {target}
        {every && ` · ${every}`}
      </div>

      <div className="relative">
        <Sparkline
          points={s.spark}
          width={300}
          height={34}
          level={down ? "crit" : latencyLevel(s.kind, s.latencyMs)}
          label={lo === null ? "no latency data" : `latency ${lo} to ${hi} ms`}
        />
        {stale && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0.5 right-0 w-[8%] rounded-xs bg-hatch text-(--b-hatch-strong)"
          />
        )}
      </div>

      <BeatBar days={s.beats90d} text={s.beatsText} height={14} />

      <div className="flex items-center justify-between gap-2 font-mono text-[11.5px] whitespace-nowrap text-muted">
        <span className="truncate">
          24h <b className="font-medium text-ink">{pct(s.uptime24h)}</b> · 30d{" "}
          <b className="font-medium text-ink">{pct(s.uptime30d)}</b>
          {s.cert && (
            <>
              {" "}
              · ssl{" "}
              <b className={cx("font-medium", s.cert.level === "ok" ? "text-ink" : LEVEL_TEXT[s.cert.level])}>
                {s.cert.valid ? `${s.cert.daysRemaining}d` : "invalid"}
              </b>
            </>
          )}
        </span>
        <Chip level={q.level}>
          {q.label} {s.health.score === null ? DASH : Math.round(s.health.score)}
        </Chip>
      </div>
    </Tile>
  );
}
