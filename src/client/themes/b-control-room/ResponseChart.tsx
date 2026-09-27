import { useId, useState } from "react";
import { EmptyState, StateDot } from "@/client/kit";
import type { ServiceView, SiteView } from "@/shared/view";
import { cx, DASH, hhmm, hhmmss, kumaStale } from "./format";
import { Chip, Micro, Tile, TileHead } from "./ui";

/** Series colours (CVD-checked in the mock-up); status colours and the brand gradient stay reserved. */
const SERIES = ["var(--b-series-1)", "var(--b-series-2)", "var(--color-maint)", "var(--color-muted)"];

/** Plot box in viewBox units; the SVG stretches to the container, strokes do not scale. */
const W = 1000;
const H = 220;
const X_TICKS = 5;

interface Group {
  id: string;
  title: string;
  services: ServiceView[];
}

/**
 * Response time of the latest checks, one tab per config section with a line per service. Missing latencies
 * break the line; a service that is down ends in a red band. The chart is plain SVG with a fixed viewBox, so
 * the server and the first client render agree.
 */
export function ResponseChart({ view }: { view: SiteView }) {
  const groups: Group[] = [
    ...view.sections.map((s) => ({ id: s.id, title: s.title, services: s.services })),
    ...(view.unsectioned.length ? [{ id: "other", title: "Other", services: view.unsectioned }] : []),
  ].filter((g) => g.services.length);
  const failing = groups.findIndex((g) => g.services.some((s) => s.state === "down"));
  const [tab, setTab] = useState(Math.max(0, failing));
  const stale = kumaStale(view);
  const group = groups[Math.min(tab, groups.length - 1)];
  const panelId = useId();

  return (
    <Tile aria-label="Response time" stale={stale} className="min-[1100px]:col-span-8">
      <TileHead className="flex-wrap">
        <div className="flex items-center gap-3">
          <Micro>Response time</Micro>
          <span className="font-mono text-[11.5px] whitespace-nowrap text-muted">
            ms · last checks<span className="hidden sm:inline"> · UTC</span>
          </span>
          {stale ? (
            <Chip level="warn">paused</Chip>
          ) : (
            <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-up/30 bg-up/6 px-2 font-mono text-[10.5px] tracking-[.08em] text-up">
              <StateDot state="up" label="live" />
              LIVE
            </span>
          )}
        </div>
        <div
          role="tablist"
          aria-label="Section"
          className="flex gap-0.5 overflow-x-auto [scrollbar-width:none]"
        >
          {groups.map((g, i) => (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={g === group}
              aria-controls={panelId}
              onClick={() => setTab(i)}
              className={cx(
                "relative rounded-md px-2.5 pt-1.5 pb-2 text-[12.5px] whitespace-nowrap hover:text-ink",
                g === group
                  ? "text-ink after:absolute after:inset-x-2.5 after:bottom-0 after:h-0.5 after:rounded-xs after:bg-gradient-brand"
                  : "text-muted",
              )}
            >
              {g.title}
            </button>
          ))}
        </div>
      </TileHead>
      <div id={panelId} role="tabpanel">
        {group ? <Chart group={group} stale={stale} /> : <EmptyState title="No monitors yet" />}
      </div>
    </Tile>
  );
}

function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function Chart({ group, stale }: { group: Group; stale: boolean }) {
  const gradId = useId();
  const series = group.services.map((s, i) => ({
    s,
    color: SERIES[i % SERIES.length]!,
    points: [...s.recent].reverse().map((b) => ({ t: Date.parse(b.ts), ts: b.ts, v: b.latencyMs })),
  }));
  const all = series.flatMap((x) => x.points);
  const values = all.map((p) => p.v).filter((v): v is number => v !== null);
  if (!all.length || !values.length)
    return (
      <div className="px-4 pb-4">
        <EmptyState title="No latency data" detail="These monitors have not reported a timed check yet." />
      </div>
    );

  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const span = t1 - t0 || 1;
  const ymax = niceMax(Math.max(...values) * 1.15 || 1);
  const X = (t: number) => ((t - t0) / span) * W;
  const Y = (v: number) => H - (v / ymax) * H;
  const ticks = Array.from({ length: X_TICKS }, (_, i) =>
    new Date(t0 + (span * i) / (X_TICKS - 1)).toISOString(),
  );
  const short = span > 3 * 3600_000;

  const drawn = series.map((x) => {
    let d = "";
    let on = false;
    let last: { t: number; v: number } | null = null;
    for (const p of x.points) {
      if (p.v === null) {
        on = false;
        continue;
      }
      d += `${on ? "L" : "M"}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`;
      on = true;
      last = { t: p.t, v: p.v };
    }
    const firstX = x.points.find((p) => p.v !== null);
    const area = last && firstX ? `${d}L${X(last.t).toFixed(1)} ${H}L${X(firstX.t).toFixed(1)} ${H}Z` : "";
    return { ...x, d, area, last, down: x.s.state === "down" };
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 pt-3 text-[12.5px]">
        {drawn.map((x) => (
          <span key={x.s.id} className="flex items-center gap-2">
            <i className="inline-block h-[3px] w-3 rounded" style={{ background: x.color }} />
            {x.s.name}
            <span className="font-mono text-[11.5px] text-muted">
              avg {x.s.avgLatencyMs === null ? DASH : Math.round(x.s.avgLatencyMs)} ms
            </span>
          </span>
        ))}
      </div>

      <div className="grid grid-cols-[40px_minmax(0,1fr)_64px] px-2 pt-4 pb-2 font-mono text-[10.5px] text-muted md:grid-cols-[46px_minmax(0,1fr)_72px]">
        <div className="relative">
          {[0, 1, 2, 3, 4].map((k) => (
            <span
              key={k}
              className="absolute right-2.5 -translate-y-1/2"
              style={{ top: `${((4 - k) / 4) * 100}%` }}
            >
              {Math.round((ymax * k) / 4)}
            </span>
          ))}
        </div>

        <div className="relative h-[200px] md:h-[210px]">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Response time of the latest checks for ${group.services.map((s) => s.name).join(" and ")}`}
            className="absolute inset-0 size-full overflow-visible"
          >
            <defs>
              {drawn.map((x, i) => (
                <linearGradient key={x.s.id} id={`${gradId}-${i}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" style={{ stopColor: x.color }} stopOpacity={i ? 0.12 : 0.22} />
                  <stop offset="1" style={{ stopColor: x.color }} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {[0, 1, 2, 3, 4].map((k) => (
              <line
                key={k}
                x1="0"
                x2={W}
                y1={(H * k) / 4}
                y2={(H * k) / 4}
                className={k === 4 ? "stroke-(--b-hair3)" : "stroke-hair"}
                strokeDasharray={k === 4 ? undefined : "2 4"}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {drawn.map((x, i) =>
              x.down && x.last ? (
                <rect
                  key={`down-${x.s.id}`}
                  x={X(x.last.t)}
                  y="0"
                  width={W - X(x.last.t)}
                  height={H}
                  className="fill-down/12"
                />
              ) : (
                x.down && <rect key={`down-${i}`} x="0" y="0" width={W} height={H} className="fill-down/12" />
              ),
            )}
            {drawn.map((x, i) => (
              <g key={x.s.id}>
                {x.area && <path d={x.area} fill={`url(#${gradId}-${i})`} />}
                <path
                  d={x.d}
                  fill="none"
                  style={{ stroke: x.color }}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
          </svg>
          {stale && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 right-0 w-[3%] bg-hatch text-(--b-hatch-strong)"
            />
          )}
          {drawn.map(
            (x) =>
              x.last && (
                <span
                  key={x.s.id}
                  aria-hidden="true"
                  className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel"
                  style={{
                    left: `${(X(x.last.t) / W) * 100}%`,
                    top: `${(Y(x.last.v) / H) * 100}%`,
                    background: x.color,
                  }}
                />
              ),
          )}
        </div>

        <div className="relative">
          {drawn.map(
            (x, i) =>
              x.last && (
                <span
                  key={x.s.id}
                  className="absolute left-2.5 -translate-y-1/2 whitespace-nowrap text-ink"
                  style={{ top: `calc(${(Y(x.last.v) / H) * 100}% + ${endNudge(drawn, i, Y)}px)` }}
                >
                  {x.last.v} ms
                </span>
              ),
          )}
          {drawn.some((x) => x.down) && <span className="absolute bottom-0 left-2.5 text-down">down</span>}
        </div>

        <div />
        <div className="relative mt-2 h-4">
          {ticks.map((t, i) => (
            <span
              key={t}
              className={cx(
                "absolute",
                i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
                i % 2 === 1 && "max-md:hidden",
              )}
              style={{ left: `${(i / (ticks.length - 1)) * 100}%` }}
            >
              {short ? hhmm(t) : hhmmss(t)}
            </span>
          ))}
        </div>
        <div />
      </div>
    </>
  );
}

/** Pushes a later series' end label down when it would sit on an earlier one. */
function endNudge(drawn: { last: { v: number } | null }[], i: number, Y: (v: number) => number): number {
  const me = drawn[i]?.last;
  if (!me) return 0;
  const clash = drawn.slice(0, i).some((o) => o.last && Math.abs(Y(o.last.v) - Y(me.v)) < 14);
  return clash ? 13 : 0;
}
