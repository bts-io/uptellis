import { type ReactNode, useId } from "react";
import { Age, BlockHeader } from "@/client/kit";
import type { SiteView } from "@/shared/view";
import { cx, hhmmss } from "./format";

interface BlockProps {
  id?: string;
  title: string;
  command: string;
  aside?: ReactNode;
  exitCode?: 0 | 1;
  /** The data behind the block is stale: muted badge, no failure tint, colours desaturated. */
  stale?: boolean;
  children: ReactNode;
}

/** A command block: hairline rule on top, a 2px rule on the left (red and tinted while it fails), plain header. */
export function Block({ id, title, command, aside, exitCode, stale = false, children }: BlockProps) {
  const headingId = useId();
  const fail = exitCode === 1 && !stale;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-fail={fail || undefined}
      className={cx(
        "relative scroll-mt-4 border-t border-line bg-panel px-4 pt-[18px] pb-6 md:px-7",
        "before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:content-['']",
        fail
          ? "bg-[linear-gradient(90deg,color-mix(in_oklab,var(--color-down)_4.5%,transparent),transparent_40%)] before:bg-down"
          : "before:bg-line",
      )}
    >
      <BlockHeader
        id={headingId}
        title={title}
        command={command}
        aside={aside}
        exitCode={exitCode}
        stale={stale}
        level={fail ? "crit" : undefined}
      />
      <div className={cx("mt-3.5", stale && "saturate-[.4]")}>{children}</div>
    </section>
  );
}

/** How old a block's data is: a ticking age while live, the snapshot time once the source has gone stale. */
export function DataAge({ view, since, stale }: { view: SiteView; since: string | null; stale: boolean }) {
  if (stale) return <span>as of {hhmmss(since ?? view.generatedAt)}</span>;
  if (!since) return null;
  return <Age since={since} now={view.now} />;
}

/** When the Kuma collector last reported (monitor blocks age with it). */
export const kumaSeenAt = (view: SiteView) =>
  view.freshness.perSource.find((s) => s.kind === "kuma")?.lastSeenAt ?? view.generatedAt;
