import { Fragment } from "react";
import { cx } from "./cx";
import type { SummaryPartsProps } from "./props";
import { LEVEL_TONE, TEXT } from "./tone";

/** A group's summary line, each part in its level's colour; `data-level` marks the coloured parts. */
export function SummaryParts({ parts, stale = false, className }: SummaryPartsProps) {
  return (
    <span className={className}>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span
            data-level={p.level ?? undefined}
            className={cx(
              p.level && (p.level === "info" || !stale) && TEXT[LEVEL_TONE[p.level]],
              p.emphasis && "font-semibold",
            )}
          >
            {p.text}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
