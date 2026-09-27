import type { CSSProperties } from "react";
import { cx } from "./cx";
import { Icon } from "./icon";
import type { KeyValueGridProps } from "./props";

/**
 * The summary box: icon, key and free content per item. One column on mobile; from md two columns and from
 * lg `columns` columns, filled top to bottom then left to right like the terminal panel.
 */
export function KeyValueGrid({ items, columns = 3 }: KeyValueGridProps) {
  const style = {
    "--kit-rows-md": `repeat(${Math.ceil(items.length / 2)}, auto)`,
    "--kit-rows-lg": `repeat(${Math.ceil(items.length / columns)}, auto)`,
  } as CSSProperties;
  return (
    <dl
      style={style}
      className={cx(
        "m-0 grid grid-cols-1 gap-y-[5px] font-mono text-[13px] md:grid-flow-col md:grid-cols-2 md:grid-rows-(--kit-rows-md) md:gap-x-10",
        columns === 3 && "lg:grid-cols-3 lg:grid-rows-(--kit-rows-lg)",
      )}
    >
      {items.map((it) => (
        <div
          key={it.label}
          className="grid min-w-0 grid-cols-[18px_10ch_minmax(0,1fr)] items-start gap-x-2 md:grid-cols-[18px_11ch_minmax(0,1fr)] md:items-center md:whitespace-nowrap"
        >
          <Icon name={it.icon} className="mt-[3px] text-muted md:mt-0" />
          <dt className="font-semibold text-accent">{it.label}</dt>
          <dd className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 md:flex-nowrap md:overflow-hidden md:text-ellipsis">
            {it.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
