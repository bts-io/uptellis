import { cx } from "./cx";
import type { BlockHeaderProps } from "./props";

/**
 * One row: the title and the command as a muted tag on the left (the tag truncates first), the aside and the
 * exit badge on the right. The badge reads `✓ 0` or `✗ 1`; screen readers hear "exit 0".
 */
export function BlockHeader({ title, command, aside, exitCode, stale = false, level, id }: BlockHeaderProps) {
  const badge =
    exitCode === undefined
      ? null
      : stale
        ? "bg-muted/10 text-faint"
        : exitCode === 0
          ? "bg-up/8 text-up"
          : "bg-down/12 text-down";
  return (
    <div className="flex min-h-6 items-center gap-2 whitespace-nowrap md:gap-3">
      <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden md:gap-3">
        <h2
          id={id}
          className={cx(
            "m-0 shrink-0 font-sans text-sm leading-[1.3] font-semibold tracking-[-0.005em] md:text-[15px]",
            level === "crit" ? "text-down" : "text-ink",
          )}
        >
          {title}
        </h2>
        {command && (
          <code className="min-w-0 truncate font-mono text-xs leading-[1.3] text-faint">{command}</code>
        )}
      </div>
      {(aside !== undefined || badge) && (
        <div className="flex shrink-0 items-center gap-2 font-mono text-xs leading-[1.3] text-muted md:gap-3">
          {aside}
          {badge && (
            <span
              data-exit={exitCode}
              className={cx(
                "rounded px-[7px] py-[3px] text-xs leading-none font-semibold tracking-[0.02em]",
                badge,
              )}
            >
              <span aria-hidden="true">{exitCode === 0 ? "✓" : "✗"}</span>
              <span className="sr-only">exit</span> {exitCode}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
