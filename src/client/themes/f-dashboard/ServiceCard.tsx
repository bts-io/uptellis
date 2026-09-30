import { useId } from "react";
import type { ServiceView } from "@/shared/view";
import { cx, day, ms, pct, STATE_LABEL, sparkPaths, stateLabel, tickFill, when } from "./format";
import { StatePill } from "./ui";

const LINE: Record<string, string> = {
  stale: "var(--color-stale)",
  down: "var(--color-down)",
  degraded: "var(--color-degraded)",
};

const BORDER: Record<string, string> = {
  down: "border-[color-mix(in_srgb,var(--color-down)_55%,var(--color-line))]",
  degraded: "border-[color-mix(in_srgb,var(--color-degraded)_55%,var(--color-line))]",
};

/**
 * One service: name, kind and target with its state pill; latest latency beside the latency trend; the
 * recent checks; uptimes and certificate (or health); the 90-day bar; reasons for lost health points.
 * `id="svc-<id>"` is the palette's jump target.
 */
export function ServiceCard({ service: s }: { service: ServiceView }) {
  const color = LINE[s.state] ?? "var(--color-accent)";
  const lastMsg = s.recent[0]?.message;
  const latLabel =
    s.state === "down"
      ? `no response${lastMsg ? ` (${lastMsg})` : ""}`
      : `latency${s.avgLatencyMs !== null ? `, avg ${Math.round(s.avgLatencyMs)} ms` : ""}`;
  const first = s.beats90d[0]?.day;
  const hs = s.health;
  const stale = s.state === "stale";

  return (
    <li
      id={`svc-${s.id}`}
      tabIndex={-1}
      data-state={s.state}
      aria-label={`${s.name}: ${STATE_LABEL[s.state] ?? s.state}`}
      className={cx(
        "flex min-w-0 flex-col gap-3 rounded-[18px] border p-4 shadow-(--f-shadow) sm:p-[18px]",
        "motion-safe:transition-transform motion-safe:hover:-translate-y-px",
        BORDER[s.state] ?? "border-line",
        stale ? "bg-raised" : "bg-panel",
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <h3 className="m-0 text-[15.5px] leading-[1.3] font-bold">{s.name}</h3>
          <p className="m-0 text-[12.5px] [overflow-wrap:anywhere] text-muted">
            <span className="mr-1.5 inline-block rounded-md border border-line bg-raised px-1.5 py-px align-[1px] text-[10.5px] font-bold tracking-[0.06em] uppercase">
              {s.kind}
            </span>
            {s.targetDisplay ?? ""}
          </p>
        </div>
        <StatePill state={s.state} />
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3.5">
        <div>
          <strong className="text-2xl leading-none font-extrabold tracking-[-0.02em] tabular-nums">
            {s.latencyMs === null ? (
              "n/a"
            ) : (
              <>
                {ms(s.latencyMs)}
                <small className="ml-0.5 text-[13px] font-semibold tracking-normal text-muted">ms</small>
              </>
            )}
          </strong>
          <span className="mt-1 block text-[11.5px] font-semibold text-muted">{latLabel}</span>
        </div>
        {s.spark.length >= 2 ? (
          <Spark points={s.spark} color={color} dim={stale} />
        ) : (
          <p
            className={cx(
              "m-0 flex h-11 items-center justify-end text-right text-[12.5px] font-semibold",
              s.state === "down" ? "text-(--f-down-text)" : "text-muted",
            )}
          >
            {s.state === "down" ? "No response to recent checks" : "Not enough latency data"}
          </p>
        )}
      </div>

      <Checks service={s} />

      <dl className="m-0 grid grid-cols-3 gap-2 border-t border-hair pt-3">
        <Stat label="Uptime 24h" value={pct(s.uptime24h)} />
        <Stat label="Uptime 30d" value={pct(s.uptime30d)} />
        {s.cert ? (
          <Stat label="Certificate" value={s.cert.valid ? `${s.cert.daysRemaining} d` : "invalid"} />
        ) : (
          <Stat label="Health" value={hs.score === null ? "n/a" : hs.score.toFixed(1)} />
        )}
      </dl>

      <div>
        <Bars90 service={s} />
        <div aria-hidden="true" className="mt-1 flex justify-between text-[11px] text-muted">
          <span>{first ? day(first) : "90 days ago"}</span>
          <span>Today</span>
        </div>
      </div>

      {s.state !== "up" && hs.reasons.length > 0 && (
        <p className="m-0 text-xs text-muted">{hs.reasons.join("; ")}</p>
      )}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-semibold text-muted">{label}</dt>
      <dd className="m-0 text-sm font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/** Area sparkline of latency points (oldest first), in the state's colour. */
function Spark({ points, color, dim }: { points: number[]; color: string; dim: boolean }) {
  const id = useId();
  const paths = sparkPaths(points, 200, 44)!;
  const label = `Latency trend over the last ${points.length} checks, from ${Math.round(points[0]!)} to ${Math.round(points.at(-1)!)} ms`;
  return (
    <svg
      viewBox="0 0 200 44"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cx("block h-11 w-full", dim && "opacity-55")}
    >
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={paths.area} fill={`url(#${id})`} />
      <path
        d={paths.line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** The recent checks as a strip of ticks, oldest first; each tick's title is its time, state and latency. */
function Checks({ service: s }: { service: ServiceView }) {
  if (!s.recent.length) return null;
  const list = [...s.recent].reverse();
  const counts = new Map<string, number>();
  for (const b of list) counts.set(b.status, (counts.get(b.status) ?? 0) + 1);
  const desc = [...counts]
    .map(([k, n]) => `${n} ${stateLabel(k as ServiceView["status"]).toLowerCase()}`)
    .join(", ");
  return (
    <div role="img" aria-label={`Last ${list.length} checks: ${desc}`} className="flex h-2.5 gap-0.5">
      {list.map((b) => (
        <i
          key={b.ts}
          data-check={b.status}
          title={`${when(b.ts)}: ${stateLabel(b.status)}${b.latencyMs !== null ? `, ${b.latencyMs} ms` : ""}${b.message ? `, ${b.message}` : ""}`}
          className="min-w-0.5 flex-1 rounded-[2px]"
          style={{ background: tickFill(b.status) }}
        />
      ))}
    </div>
  );
}

/** 90 daily ticks, oldest first; each tick's title is its day, worst state, uptime and minutes down. */
function Bars90({ service: s }: { service: ServiceView }) {
  const n = s.beats90d.length || 90;
  const width = n * 4 - 1;
  const bad = s.beats90d.filter((b) => b.worst === "down").length;
  const warn = s.beats90d.filter((b) => b.worst === "degraded" || b.worst === "pending").length;
  return (
    <svg
      viewBox={`0 0 ${width} 26`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`90-day history, ${bad} days with downtime, ${warn} degraded days: ${s.beatsText}`}
      className="block h-[26px] w-full"
    >
      {s.beats90d.map((b, i) => (
        <rect key={b.day} x={i * 4} y="0" width="3" height="26" rx="1" fill={tickFill(b.worst)}>
          <title>
            {`${day(b.day)}: ${stateLabel(b.worst)}${b.uptime !== null ? `, ${pct(b.uptime)}` : ""}${b.minutesDown ? `, ${b.minutesDown} min down` : ""}`}
          </title>
        </rect>
      ))}
    </svg>
  );
}
