import type { BeatView } from "@/shared/view";
import { millis } from "./model";

const W = 700;
const H = 200;
const PAD = { l: 56, r: 10, t: 12, b: 28 };

/**
 * Response time of a service's recent checks (oldest left), as one SVG image with a sentence for screen
 * readers: the average, fastest and slowest, and how many checks failed. Failed checks (no reply) break
 * the line and are shaded.
 */
export function ResponseChart({ recent }: { recent: BeatView[] }) {
  const pts = [...recent].reverse();
  const vals = pts.flatMap((p) => (p.latencyMs === null ? [] : [p.latencyMs]));
  if (vals.length === 0) return <p className="text-sm text-muted">No response times yet.</p>;
  const max = Math.max(100, Math.ceil(Math.max(...vals) / 100) * 100);
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / Math.max(1, pts.length - 1);
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const step = (W - PAD.l - PAD.r) / Math.max(1, pts.length - 1);
  const segments: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (const [i, p] of pts.entries()) {
    if (p.latencyMs === null) {
      if (cur.length) segments.push(cur);
      cur = [];
    } else cur.push([x(i), y(p.latencyMs)]);
  }
  if (cur.length) segments.push(cur);
  const failed = pts.length - vals.length;
  const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  const label = `Response time for the last ${pts.length} checks: average ${avg} ms, fastest ${Math.round(Math.min(...vals))} ms, slowest ${Math.round(Math.max(...vals))} ms${failed ? `, ${failed} failed checks` : ""}.`;
  const time = (ts: string) => ts.slice(11, 16);
  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="block h-auto w-full text-accent"
      >
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" className="fill-muted text-[11px]">
              {v} ms
            </text>
          </g>
        ))}
        {pts.map((p, i) =>
          p.latencyMs === null ? (
            <rect
              key={p.ts}
              x={x(i) - step / 2}
              y={PAD.t}
              width={step}
              height={H - PAD.t - PAD.b}
              className="fill-down"
              opacity={0.15}
            />
          ) : null,
        )}
        {segments.map((s) => {
          const d = s.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)} ${b.toFixed(1)}`).join(" ");
          return (
            <g key={d}>
              {s.length > 1 && (
                <path
                  d={`${d} L${s[s.length - 1]![0].toFixed(1)} ${H - PAD.b} L${s[0]![0].toFixed(1)} ${H - PAD.b} Z`}
                  fill="currentColor"
                  opacity={0.12}
                />
              )}
              <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
            </g>
          );
        })}
        <text x={PAD.l} y={H - 8} className="fill-muted text-[11px]">
          {time(pts[0]!.ts)}
        </text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end" className="fill-muted text-[11px]">
          {time(pts[pts.length - 1]!.ts)} UTC
        </text>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 text-xs text-muted">
        <span>Average {millis(avg)}</span>
        {failed > 0 && <span className="text-down">Failed checks: {failed}</span>}
      </figcaption>
    </figure>
  );
}
