import type { ServiceView } from "@/shared/view";
import { day, dur, historyStats, pct, siteDays, stateLabel, tickFill } from "./format";

const W = 900;
const H = 140;

const KEY = [
  ["var(--color-up)", "Operational"],
  ["var(--color-degraded)", "Degraded"],
  ["var(--color-down)", "Downtime"],
  ["var(--color-maint)", "Maintenance"],
  ["var(--f-empty-tick)", "No data"],
] as const;

/**
 * The site's 90 days as a column chart: each day's mean uptime across services on a scale that starts just
 * under the worst day, coloured by the day's worst state. Nothing without services.
 */
export function History({ services }: { services: ServiceView[] }) {
  if (!services.length) return null;
  const days = siteDays(services);
  const n = days.length;
  const h = historyStats(days);
  const bw = W / Math.max(1, n);
  const inner = Math.max(1, bw - 2);
  const first = days[0]?.day;
  const mid = days[Math.floor(n / 2)]?.day;

  return (
    <section
      aria-labelledby="f-hist-h"
      className="mb-6 min-w-0 rounded-[18px] border border-line bg-panel p-4 shadow-(--f-shadow) sm:p-5"
    >
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 id="f-hist-h" className="m-0 text-[15px] font-bold tracking-[-0.005em]">
            90-day uptime
          </h2>
          <p className="m-0 text-[13px] text-muted">Daily mean across all services</p>
        </div>
        <dl className="m-0 flex flex-wrap gap-6">
          <Stat value={pct(h.mean, 3)} label="Average" />
          <Stat value={String(h.downDays)} label="Days with downtime" />
          <Stat value={dur(h.minutesDown * 60)} label="Service downtime" />
        </dl>
      </div>

      <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5">
        <div
          aria-hidden="true"
          className="flex h-[110px] flex-col justify-between text-right text-[11px] text-muted tabular-nums sm:h-[140px]"
        >
          <span>100%</span>
          <span>{(((1 + h.floor) / 2) * 100).toFixed(2)}%</span>
          <span>{(h.floor * 100).toFixed(1)}%</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Daily mean uptime over ${n} days, ${h.downDays} days with downtime, ${h.degradedDays} degraded days`}
          className="block h-[110px] w-full sm:h-[140px]"
        >
          {[0, 0.5, 1].map((t) => {
            const y = (t * (H - 2) + 1).toFixed(1);
            return (
              <line
                key={t}
                x1="0"
                x2={W}
                y1={y}
                y2={y}
                stroke="var(--color-line)"
                strokeDasharray="3 4"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {days.map((d, i) => {
            const x = (i * bw + 1).toFixed(1);
            if (d.uptime === null)
              return (
                <rect
                  key={d.day || i}
                  x={x}
                  y={H - 6}
                  width={inner.toFixed(1)}
                  height="6"
                  rx="1.5"
                  fill="var(--f-empty-tick)"
                >
                  <title>{`${day(d.day)}: no data`}</title>
                </rect>
              );
            const t = Math.max(0.04, (d.uptime - h.floor) / (1 - h.floor));
            const ch = Math.max(6, t * H);
            const tip = `${day(d.day)}: ${pct(d.uptime, 3)} mean uptime${d.minutesDown ? `, ${d.minutesDown} service-min down` : ""}, worst ${stateLabel(d.worst)}`;
            return (
              <rect
                key={d.day || i}
                data-worst={d.worst ?? "none"}
                x={x}
                y={(H - ch).toFixed(1)}
                width={inner.toFixed(1)}
                height={ch.toFixed(1)}
                rx="1.5"
                fill={tickFill(d.worst)}
                fillOpacity={d.worst === "up" ? 0.78 : 1}
              >
                <title>{tip}</title>
              </rect>
            );
          })}
        </svg>
        <div aria-hidden="true" className="col-start-2 mt-1.5 flex justify-between text-[11px] text-muted">
          <span>{first ? day(first) : ""}</span>
          <span>{mid ? day(mid) : ""}</span>
          <span>Today</span>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-(--f-text-2)"
      >
        {KEY.map(([fill, label]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <i className="inline-block size-2.5 rounded-[3px]" style={{ background: fill }} />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="m-0 text-xl font-extrabold tracking-[-0.01em] tabular-nums">{value}</dd>
    </div>
  );
}
