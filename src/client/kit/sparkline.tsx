import { useId } from "react";
import { cx } from "./cx";
import type { SparklineProps } from "./props";
import { LEVEL_TONE, TEXT } from "./tone";

/**
 * Line and area paths for `points` in a `width` x `height` box. The range is padded (35% below, 21% above)
 * so a flat series still gets a range; coordinates have one decimal, so the same input always yields the same
 * string. Null when there are no points.
 */
export function sparkPaths(
  points: number[],
  width: number,
  height: number,
): { line: string; area: string } | null {
  if (points.length === 0) return null;
  // A single point draws as a flat line across the box.
  const pts = points.length === 1 ? [points[0]!, points[0]!] : points;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const pad = (hi - lo) * 0.35 || 1;
  const min = lo - pad;
  const max = hi + pad * 0.6;
  const step = width / (pts.length - 1);
  const line = pts
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${(i * step).toFixed(1)} ${(height - ((v - min) / (max - min)) * height).toFixed(1)}`,
    )
    .join(" ");
  return { line, area: `${line} L${width.toFixed(1)} ${height} L0 ${height} Z` };
}

/** Inline SVG latency sparkline with a soft area fill; fixed viewBox, stretched to the container width. */
export function Sparkline({ points, width = 300, height = 40, level = "ok", label }: SparklineProps) {
  const gradientId = useId();
  const paths = sparkPaths(points, width, height);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cx("block w-full overflow-visible", TEXT[LEVEL_TONE[level]])}
      style={{ height }}
    >
      {paths ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="1" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={paths.area} fill={`url(#${gradientId})`} />
          <path
            d={paths.line}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      ) : (
        <line
          x1="0"
          x2={width}
          y1={height / 2}
          y2={height / 2}
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeDasharray="3 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
