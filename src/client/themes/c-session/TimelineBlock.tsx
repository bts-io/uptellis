import { type ReactNode, useId } from "react";
import { EmptyState, StateDot } from "@/client/kit";
import type { BeatView, ServiceView, SiteView } from "@/shared/view";
import { Block, DataAge, kumaSeenAt } from "./Block";
import { allServices, checkType, cx, DASH, failing, hhmm, isStale, pct } from "./format";

const W = 1000;
const H = 34;

/** Fill class per check status (SVG `fill`, spelled out for Tailwind's scanner). */
const FILL: Record<BeatView["status"], string> = {
  up: "fill-up",
  degraded: "fill-degraded",
  pending: "fill-degraded",
  down: "fill-down",
  maintenance: "fill-maint",
  paused: "fill-faint",
  unknown: "fill-faint",
};

/** A span of time as `45s`, `12m`, `3h`. */
function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

/** The window every lane shares: from the oldest recent check to now (to the newest check once stale). */
interface Window {
  start: number;
  end: number;
  /** Share of the lane width drawn as the hatched no-data tail (stale only). */
  tail: number;
}

function laneWindow(view: SiteView, services: ServiceView[], stale: boolean): Window | null {
  const ts = services.flatMap((s) => s.recent.map((b) => Date.parse(b.ts)));
  if (!ts.length) return null;
  const now = Date.parse(view.now);
  const start = Math.min(...ts);
  const end = stale ? Math.max(...ts) : now;
  if (end <= start) return null;
  // The quiet time is shown at a readable width (2.5% to 20% of the lane), not to scale.
  const tail = stale ? Math.min(0.2, Math.max(0.025, (now - end) / (now - start))) : 0;
  return { start, end, tail };
}

/**
 * The recent checks of every monitor on one time axis: each lane tints the state runs with a floor bar and
 * draws the latency line inside, so one strip carries both. Selecting a lane retargets the inspect block.
 */
export function TimelineBlock({
  view,
  selected,
  onSelect,
}: {
  view: SiteView;
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const stale = isStale(view);
  const services = allServices(view);
  const win = laneWindow(view, services, stale);
  const span = win ? win.end - win.start : 0;
  const checks = Math.max(0, ...services.map((s) => s.recent.length));
  const now = Date.parse(view.now);

  return (
    <Block
      id="timeline"
      title={win ? `Timeline ${ago(span)}` : "Timeline"}
      command={win ? `monitors --timeline ${ago(span)}` : "monitors --timeline"}
      aside={<DataAge view={view} since={kumaSeenAt(view)} stale={stale} />}
      exitCode={services.some(failing) ? 1 : 0}
      stale={stale}
    >
      {services.length === 0 ? (
        <EmptyState title="No monitors yet" detail="No source has reported." />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-center md:grid-cols-[210px_minmax(0,1fr)_78px_70px_70px] md:gap-x-[18px]">
          <Head>monitor</Head>
          <Head className="max-md:hidden">state + latency, last {checks} checks</Head>
          <Head className="text-right max-md:hidden">now</Head>
          <Head className="text-right max-md:hidden">24h</Head>
          <Head className="text-right max-md:hidden">30d</Head>
          {services.map((s) => (
            <Lane
              key={s.id}
              service={s}
              win={win}
              stale={stale}
              selected={s.id === selected}
              onSelect={onSelect}
            />
          ))}
          {win && (
            <>
              <div className="max-md:hidden" />
              <div className="flex justify-between border-t border-(--c-rule-soft) pt-2 font-mono text-[11px] leading-none text-faint">
                {[0, 1, 2, 3].map((k) => (
                  <span key={k} className={cx(k > 0 && k < 3 && "max-md:hidden")}>
                    -{ago(now - (win.start + (k * (win.end - win.start)) / 4))}
                  </span>
                ))}
                <span className="text-accent">
                  {stale ? `now · no data since ${hhmm(new Date(win.end).toISOString())}` : "now"}
                </span>
              </div>
              <div className="col-span-3 max-md:hidden" />
            </>
          )}
        </div>
      )}
    </Block>
  );
}

function Head({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "pb-2.5 font-mono text-[11px] leading-none font-medium tracking-[0.08em] text-muted uppercase",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Lane({
  service: s,
  win,
  stale,
  selected,
  onSelect,
}: {
  service: ServiceView;
  win: Window | null;
  stale: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const cell = "md:border-t md:border-(--c-rule-soft) md:py-[7px]";
  const value = "text-right font-mono text-[13px] leading-none whitespace-nowrap max-md:hidden";
  return (
    <div className="group contents" data-selected={selected || undefined}>
      <button
        type="button"
        id={`svc-${s.id}`}
        data-c-lane={s.id}
        aria-pressed={selected}
        aria-label={`${s.name}, ${s.state}. Inspect`}
        onClick={() => onSelect(s.id)}
        className={cx(
          cell,
          "flex min-w-0 cursor-pointer items-center gap-2.5 border-t border-(--c-rule-soft) bg-transparent pt-2.5 text-left text-ink max-md:pb-0 md:pt-[7px]",
          selected && "pl-2.5 shadow-[inset_2px_0_0_var(--color-accent)]",
        )}
      >
        <StateDot state={s.state} />
        <span className="min-w-0">
          <span
            className={cx(
              "block font-mono text-[13px] leading-[1.25] font-medium whitespace-nowrap group-focus-within:text-accent",
              selected && "text-accent",
            )}
          >
            {s.name}
          </span>
          <span className="block truncate font-sans text-[11.5px] leading-[1.3] text-muted">
            {checkType(s)}
            {s.targetDisplay && ` · ${s.targetDisplay}`}
          </span>
        </span>
      </button>
      <div className={cx(cell, "flex items-center pt-1.5 pb-0.5 md:h-[50px]")}>
        {win ? <LaneChart service={s} win={win} stale={stale} /> : <div className="h-7 w-full md:h-[34px]" />}
      </div>
      <div className={cx(cell, value)}>
        {s.latencyMs === null ? DASH : s.latencyMs}
        {s.latencyMs !== null && <small className="ml-0.5 text-[11px] text-muted">ms</small>}
      </div>
      <div className={cx(cell, value)}>
        {pct(s.uptime24h)}
        {s.uptime24h !== null && <small className="ml-0.5 text-[11px] text-muted">%</small>}
      </div>
      <div className={cx(cell, value, "text-muted")}>
        {pct(s.uptime30d)}
        {s.uptime30d !== null && <small className="ml-0.5 text-[11px]">%</small>}
      </div>
      <div className="flex justify-between pt-1 pb-2.5 font-mono text-xs leading-none text-muted md:hidden">
        <span>
          {s.latencyMs === null ? (
            <b className="font-normal text-down">no response</b>
          ) : (
            <>
              <b className="font-normal text-ink">{s.latencyMs}</b> ms
            </>
          )}
        </span>
        <span>
          24h <b className="font-normal text-ink">{pct(s.uptime24h)}%</b> · 30d{" "}
          <b className="font-normal text-ink">{pct(s.uptime30d)}%</b>
        </span>
      </div>
    </div>
  );
}

/** One lane: state runs (tint plus a 3px floor bar), quarter gridlines, the latency line, the stale tail, the now edge. */
function LaneChart({ service, win, stale }: { service: ServiceView; win: Window; stale: boolean }) {
  const gradientId = useId();
  const hatchId = useId();
  const wd = W * (1 - win.tail);
  const x = (ts: string) => ((Date.parse(ts) - win.start) / (win.end - win.start)) * wd;
  const beats = [...service.recent].reverse();

  const runs = beats.map((b, i) => {
    const x0 = x(b.ts);
    const x1 = i + 1 < beats.length ? x(beats[i + 1]!.ts) : wd;
    // A failure gets at least 7 units so a single failed check stays visible.
    const w = b.status === "down" ? Math.max(x1 - x0, 7) : x1 - x0;
    return { key: b.ts, x: Math.min(x0, wd - w), w, status: b.status };
  });

  const lat = beats.filter((b) => b.latencyMs !== null).map((b) => b.latencyMs!);
  const lo = Math.min(...lat);
  const hi = Math.max(...lat);
  const range = Math.max(hi - lo, (service.avgLatencyMs ?? hi) * 0.35, 1);
  const mid = (hi + lo) / 2;
  const y = (v: number) => (5 + (1 - (v - (mid - range / 2)) / range) * (H - 12)).toFixed(1);
  // Pen-up at checks without latency, so a timeout breaks the line.
  const segments: { x: number; y: string }[][] = [];
  let pen = false;
  for (const b of beats) {
    if (b.latencyMs === null) {
      pen = false;
      continue;
    }
    if (!pen) segments.push([]);
    segments.at(-1)!.push({ x: x(b.ts), y: y(b.latencyMs) });
    pen = true;
  }
  const line = segments
    .map((seg) => seg.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y}`).join(""))
    .join("");
  const area = segments
    .filter((seg) => seg.length > 1)
    .map(
      (seg) =>
        `M${seg[0]!.x.toFixed(1)} ${H - 3}${seg.map((p) => `L${p.x.toFixed(1)} ${p.y}`).join("")}L${seg.at(-1)!.x.toFixed(1)} ${H - 3}Z`,
    )
    .join("");

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${service.name}: last ${beats.length} checks, latency ${lat.length ? `${lo} to ${hi} ms` : "none"}`}
      className="block h-7 w-full rounded-[3px] md:h-[34px]"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
        <pattern
          id={hatchId}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" className="fill-down/8" />
          <line x1="0" y1="0" x2="0" y2="6" strokeWidth="2" className="stroke-down/55" />
        </pattern>
      </defs>
      {runs.map((r) => (
        <g key={r.key} className={FILL[r.status]}>
          <rect x={r.x} y="0" width={r.w} height={H} opacity={r.status === "up" ? 0.07 : 0.28} />
          <rect x={r.x} y={H - 3} width={r.w} height="3" opacity={r.status === "up" ? 0.8 : 1} />
        </g>
      ))}
      {[1, 2, 3].map((k) => (
        <line
          key={k}
          x1={(wd * k) / 4}
          x2={(wd * k) / 4}
          y1="0"
          y2={H - 3}
          vectorEffect="non-scaling-stroke"
          className="stroke-hair"
        />
      ))}
      <g className="text-up">
        {area && <path d={area} fill={`url(#${gradientId})`} />}
        {line && (
          <path
            d={line}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            opacity="0.95"
          />
        )}
      </g>
      {stale && (
        <>
          <rect x={wd} y="0" width={W - wd} height={H} fill={`url(#${hatchId})`} />
          <line x1={wd} x2={wd} y1="0" y2={H} vectorEffect="non-scaling-stroke" className="stroke-down" />
        </>
      )}
      <line
        x1={W - 0.5}
        x2={W - 0.5}
        y1="0"
        y2={H}
        vectorEffect="non-scaling-stroke"
        className="stroke-accent/70"
      />
    </svg>
  );
}
