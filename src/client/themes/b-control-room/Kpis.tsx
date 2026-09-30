import type { CSSProperties, ReactNode } from "react";
import { BeatBar, Sparkline, StateDot } from "@/client/kit";
import { highlightSlots, type Level, type ServiceView, type SiteView } from "@/shared/view";
import {
  allServices,
  beatsText,
  combinedBeats,
  cx,
  DASH,
  hhmm,
  isFigure,
  kumaStale,
  LEVEL_TEXT,
  levelState,
  monthDay,
  pct,
  probeStale,
  quality,
  splitUnit,
} from "./format";
import { Chip, Micro } from "./ui";

const RING_STROKE: Record<Level, string> = {
  ok: "stroke-up",
  warn: "stroke-degraded",
  crit: "stroke-down",
  info: "stroke-muted",
};

/**
 * The summary strip: seven cells in one tile from 1100px, a row of snap-scrolling cards below. Everything here
 * is Kuma data, so it ages with the Kuma collector.
 */
export function Kpis({ view }: { view: SiteView }) {
  const s = view.summary;
  const stale = kumaStale(view);
  const services = allServices(view);
  const health = quality(s.healthScore);
  const days = combinedBeats(services);
  const known = days.filter((d) => d.uptime !== null);
  const mean90 = known.length ? known.reduce((a, d) => a + d.uptime!, 0) / known.length : null;
  const factsStale = probeStale(view);
  const slots = highlightSlots(view.highlights);
  // Four fixed cells, one per highlight slot, then the wide 90-day cell.
  const columns = {
    "--b-kpi-cols": `repeat(${4 + slots.length},minmax(0,1fr)) minmax(0,2.3fr)`,
  } as CSSProperties;
  const trend = meanSpark(services);
  const asOf = stale && (
    <span className="ml-1.5 text-[10.5px] text-degraded">as of {hhmm(view.generatedAt)}</span>
  );

  return (
    <section
      aria-label="Summary"
      style={columns}
      className={cx(
        "relative flex snap-x snap-mandatory gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] min-[1100px]:grid min-[1100px]:grid-cols-(--b-kpi-cols) min-[1100px]:gap-0 min-[1100px]:overflow-hidden min-[1100px]:rounded-[14px] min-[1100px]:border min-[1100px]:border-hair min-[1100px]:pb-0 min-[1100px]:shadow-[inset_0_1px_0_var(--b-hair2),0_1px_2px_var(--b-shadow)]",
        stale
          ? "min-[1100px]:bg-panel min-[1100px]:after:pointer-events-none min-[1100px]:after:absolute min-[1100px]:after:inset-0 min-[1100px]:after:bg-[repeating-linear-gradient(135deg,var(--b-hatch)_0_6px,transparent_6px_14px)]"
          : "min-[1100px]:bg-[linear-gradient(180deg,var(--b-tile-top),var(--b-tile-bottom))] min-[1100px]:backdrop-blur-md",
      )}
    >
      <Cell label="Monitors">
        <Value>{s.total}</Value>
        <Sub>
          <span className="flex items-center gap-1.5">
            <StateDot state={stale ? "stale" : "up"} />
            {stale ? `${s.other} stale` : `${s.up} up`}
          </span>
          <span className={cx("flex items-center gap-1.5", s.down > 0 && "text-down")}>
            <StateDot state={stale ? "stale" : s.down > 0 ? "down" : "unknown"} />
            {s.down} down
          </span>
        </Sub>
      </Cell>

      <Cell label="Avg response">
        <Value unit="ms" extra={asOf}>
          {s.avgLatencyMs === null ? DASH : Math.round(s.avgLatencyMs)}
        </Value>
        <Sub>
          {trend.length > 1 && (
            <span className="w-16">
              <Sparkline
                points={trend}
                width={64}
                height={18}
                level="ok"
                label="mean latency, recent checks"
              />
            </span>
          )}
          <span>recent</span>
        </Sub>
      </Cell>

      <Cell label="Health">
        <div className="flex items-center gap-2.5">
          <Value>{s.healthScore === null ? DASH : s.healthScore.toFixed(1)}</Value>
          {s.healthScore !== null && <Ring value={s.healthScore} level={health.level} />}
        </div>
        <Sub>
          <Chip level={health.level}>{health.label}</Chip>
          <span>/ 100</span>
        </Sub>
      </Cell>

      <Cell label="Uptime 30d">
        <Value unit={s.uptime30d === null ? undefined : "%"}>{pct(s.uptime30d)}</Value>
        <Sub>24h {s.uptime24h === null ? DASH : `${(s.uptime24h * 100).toFixed(2)}%`}</Sub>
      </Cell>

      {slots.map((slot) => {
        const [row] = slot.rows;
        const [value, unit] = splitUnit(row.display);
        // A lone value with a level and no badge or detail reads as a status: its dot, in its colour.
        const status = row.level !== null && row.level !== "info" && !slot.note && slot.rows.length === 1;
        // A status is a fact: it greys out when either the collector or the facts probe went quiet.
        const muted = stale || factsStale;
        return (
          <Cell key={slot.label} label={slot.label}>
            {status && row.level ? (
              <div
                data-status={row.level}
                className={cx(
                  "flex items-start gap-2 font-mono text-[14px] leading-[1.35] font-medium [overflow-wrap:anywhere]",
                  !muted && LEVEL_TEXT[row.level],
                )}
              >
                <span className="mt-[5px] inline-flex">
                  <StateDot state={muted ? "stale" : levelState(row.level)} />
                </span>
                {slot.texts[0]}
              </div>
            ) : isFigure(row.display) ? (
              <Value unit={unit ?? undefined}>{value}</Value>
            ) : (
              <div className="truncate font-mono text-[17px] leading-[1.55] font-medium">{slot.texts[0]}</div>
            )}
            {!status && (
              <Sub>
                {/* An update or other notice reads in the maintenance colour, not as a warning. */}
                {slot.note && (
                  <Chip level={slot.note.level === "warn" ? "maint" : slot.note.level}>{slot.note.text}</Chip>
                )}
                {(slot.rows.length > 1 || !slot.note) && (
                  <span className="truncate">{slot.texts.slice(1).join(" · ") || DASH}</span>
                )}
              </Sub>
            )}
          </Cell>
        );
      })}

      <Cell label={null} wide>
        <div className="flex items-center justify-between gap-2">
          <Micro>90 days · all monitors</Micro>
          <span className="font-mono text-[11.5px] text-ink">
            {mean90 === null ? DASH : `${(mean90 * 100).toFixed(3)}%`}
          </span>
        </div>
        {days.length > 0 && <BeatBar days={days} text={beatsText(days)} height={18} />}
        <Sub className="justify-between">
          <span>{days[0] ? monthDay(days[0].day) : DASH}</span>
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <i className="inline-block size-2 rounded-sm bg-degraded" />
              degraded
            </span>
            <span className="flex items-center gap-1">
              <i className="inline-block size-2 rounded-sm bg-down" />
              outage
            </span>
          </span>
          <span>today</span>
        </Sub>
      </Cell>
    </section>
  );
}

function Cell({ label, wide, children }: { label: string | null; wide?: boolean; children: ReactNode }) {
  return (
    <div
      className={cx(
        "flex min-w-0 shrink-0 snap-start flex-col gap-2 rounded-xl border border-hair bg-[linear-gradient(180deg,var(--b-tile-top),var(--b-tile-bottom))] px-4 py-3.5",
        "min-[1100px]:rounded-none min-[1100px]:border-0 min-[1100px]:border-r min-[1100px]:border-(--b-hair2) min-[1100px]:bg-none min-[1100px]:last:border-r-0",
        wide ? "basis-[280px]" : "basis-[150px]",
      )}
    >
      {label && <Micro>{label}</Micro>}
      {children}
    </div>
  );
}

function Value({ unit, extra, children }: { unit?: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <div className="font-mono text-[26px] leading-[1.05] font-medium tracking-[-.02em] whitespace-nowrap">
      {children}
      {unit && <small className="ml-[3px] text-[13px] font-normal tracking-normal text-muted">{unit}</small>}
      {extra}
    </div>
  );
}

function Sub({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cx(
        "flex items-center gap-2.5 font-mono text-[11.5px] whitespace-nowrap text-muted",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Ring({ value, level }: { value: number; level: Level }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" className="flex-none">
      <circle cx="14" cy="14" r={r} fill="none" className="stroke-hair" strokeWidth="3" />
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        className={RING_STROKE[level]}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${((c * value) / 100).toFixed(1)} ${c.toFixed(1)}`}
        transform="rotate(-90 14 14)"
      />
    </svg>
  );
}

/** Mean latency across services, point by point from the newest (services report different counts). */
function meanSpark(services: ServiceView[]): number[] {
  const n = Math.max(0, ...services.map((s) => s.spark.length));
  return Array.from({ length: n }, (_, i) => {
    const vals = services
      .map((s) => s.spark[s.spark.length - n + i])
      .filter((v): v is number => v !== undefined);
    return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  });
}
