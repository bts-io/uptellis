import { cx } from "./cx";
import type { GaugeProps } from "./props";
import { LEVEL_TONE, TEXT } from "./tone";

/** Number of lit cells for `value` (0..100, clamped) across `cells`. */
export const litCells = (value: number | null, cells: number) =>
  value === null ? 0 : Math.round((Math.min(100, Math.max(0, value)) / 100) * cells);

/** Segmented gauge: `cells` skewed CSS cells (exact widths, no glyphs), lit up to `value`. */
export function Gauge({ value, cells = 10, level = "ok", label }: GaugeProps) {
  const on = litCells(value, cells);
  const aria =
    value === null
      ? { role: "img", "aria-label": `${label}: no data` }
      : {
          role: "meter",
          "aria-label": label,
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": Math.round(value * 10) / 10,
        };
  return (
    <span {...aria} className={cx("inline-flex shrink-0 items-center gap-0.5", TEXT[LEVEL_TONE[level]])}>
      {Array.from({ length: cells }, (_, i) => (
        <i
          key={i}
          aria-hidden="true"
          data-on={i < on || undefined}
          className={cx(
            "block h-2.5 w-1.5 -skew-x-[14deg] bg-current",
            i < on ? "opacity-100" : "opacity-15",
          )}
        />
      ))}
    </span>
  );
}
