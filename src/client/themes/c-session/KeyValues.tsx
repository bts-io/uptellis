import type { ReactNode } from "react";
import { cx } from "./format";

/** Inline key/value pairs that wrap as a row on desktop and stack on phones. */
export function KeyValues({
  items,
  className,
}: {
  items: { label: string; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl
      className={cx("m-0 flex flex-col gap-y-2 md:flex-row md:flex-wrap md:gap-x-7 md:gap-y-2.5", className)}
    >
      {items.map((i) => (
        <div key={i.label} className="min-w-0 md:flex md:items-baseline md:gap-2.5">
          <dt className="mr-2.5 inline shrink-0 font-sans md:mr-0 text-[12.5px] leading-[1.4] text-muted">
            {i.label}
          </dt>
          <dd className="m-0 inline min-w-0 font-mono md:block text-[13px] leading-[1.4] md:whitespace-nowrap">
            {i.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
