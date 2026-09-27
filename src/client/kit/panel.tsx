import { useId } from "react";
import { cx } from "./cx";
import type { PanelProps } from "./props";

// The border labels sit on the border line: their background is the outer colour above the middle and the
// panel's own below, so the line appears to stop at the label. Themes set `--kit-in` (panel surface),
// `--kit-out` (what surrounds it) and `--kit-line` (border) on a panel, e.g. for a card nested in a panel.
const LABEL =
  "absolute top-[-1px] flex -translate-y-1/2 items-center gap-[7px] whitespace-nowrap px-[7px] leading-[18px] bg-[linear-gradient(180deg,var(--kit-out,var(--color-base))_50%,var(--kit-in,var(--color-panel))_50%)]";

/** Box with its title set into the top border (`[ monitors ]`) and an optional aside and `exit 0|1` badge. */
export function Panel({ title, exitCode, aside, level, id, className, children }: PanelProps) {
  const headingId = useId();
  const border =
    level === "crit"
      ? "border-down"
      : level === "warn"
        ? "border-degraded"
        : "border-[var(--kit-line,var(--color-line))]";
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-level={level}
      className={cx(
        "relative border bg-[var(--kit-in,var(--color-panel))] px-3.5 pt-[22px] pb-3.5 font-mono md:px-5 md:pt-6 md:pb-[18px]",
        border,
        className,
      )}
    >
      <div className={cx(LABEL, "left-3.5 max-w-[calc(100%-28px)] text-[13px]")}>
        <span aria-hidden="true" className="font-medium text-frame opacity-85">
          [
        </span>
        <h2 id={headingId} className="m-0 truncate text-[length:inherit] font-bold text-ink">
          {title}
        </h2>
        <span aria-hidden="true" className="font-medium text-frame opacity-85">
          ]
        </span>
      </div>
      {(aside !== undefined || exitCode !== undefined) && (
        <div className={cx(LABEL, "right-3.5 text-xs text-muted")}>
          {aside}
          {aside !== undefined && exitCode !== undefined && (
            <span aria-hidden="true" className="text-faint">
              ·
            </span>
          )}
          {exitCode !== undefined && (
            <span className={cx("text-[11px] tracking-[0.04em]", exitCode === 0 ? "text-up" : "text-down")}>
              {`exit ${exitCode}`}
            </span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
