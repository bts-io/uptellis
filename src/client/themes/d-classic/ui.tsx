import type { ReactNode } from "react";
import { useAgeTicker } from "@/client/effects";
import type { DisplayState, Level } from "@/shared/view";
import { cx, fmtAgo, fmtDur, isoBefore, STATE_LABEL } from "./format";

export type IconName = "check" | "warn" | "cross" | "wrench" | "clock" | "pause" | "question";

/** A ring plus a glyph: reads as a status icon from 16 to 28 px. Decorative, always next to a word. */
export function StatusIcon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false" className={cx("flex-none", className)}>
      <circle cx="10" cy="10" r="8.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <Glyph name={name} />
    </svg>
  );
}

function Glyph({ name }: { name: IconName }) {
  const line = { stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const };
  switch (name) {
    case "check":
      return <path d="M5 10.5l3.2 3.2L15 7" fill="none" {...line} strokeLinejoin="round" />;
    case "warn":
      return (
        <>
          <path d="M10 6.5v4.5" {...line} />
          <circle cx="10" cy="14" r="1.2" fill="currentColor" />
        </>
      );
    case "cross":
      return <path d="M7 7l6 6M13 7l-6 6" {...line} />;
    case "wrench":
      return <path d="M6.5 13.5l4-4M11.5 6a2.5 2.5 0 1 0 2.5 2.5" fill="none" {...line} strokeWidth={1.8} />;
    case "clock":
      return <path d="M10 6v4.2l2.6 1.6" fill="none" {...line} strokeWidth={1.8} strokeLinejoin="round" />;
    case "pause":
      return <path d="M8 7v6M12 7v6" {...line} />;
    case "question":
      return (
        <>
          <path
            d="M8.2 8.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4"
            fill="none"
            {...line}
            strokeWidth={1.8}
          />
          <circle cx="10" cy="14" r="1.1" fill="currentColor" />
        </>
      );
  }
}

export const STATE_ICON: Record<DisplayState, IconName> = {
  up: "check",
  degraded: "warn",
  pending: "clock",
  down: "cross",
  maintenance: "wrench",
  paused: "pause",
  unknown: "question",
  stale: "clock",
};

/** Text colour of a state word (the darker shades keep AA on white). */
export const STATE_TEXT: Record<DisplayState, string> = {
  up: "text-(--d-up-text)",
  degraded: "text-(--d-degraded-text)",
  pending: "text-(--d-degraded-text)",
  down: "text-(--d-down-text)",
  maintenance: "text-(--d-maint-text)",
  paused: "text-(--d-stale-text)",
  unknown: "text-(--d-stale-text)",
  stale: "text-(--d-stale-text)",
};

export const LEVEL_STATE: Record<Level, DisplayState> = {
  ok: "up",
  warn: "degraded",
  crit: "down",
  info: "unknown",
};

/** State label: icon and word, never colour alone. */
export function StateTag({ state, label }: { state: DisplayState; label?: string }) {
  return (
    <span
      data-s={state}
      className={cx(
        "inline-flex flex-none items-center gap-1.5 text-[13px] font-medium whitespace-nowrap",
        STATE_TEXT[state],
      )}
    >
      <StatusIcon name={STATE_ICON[state]} className="size-4" />
      {label ?? STATE_LABEL[state]}
    </span>
  );
}

/**
 * An age that ticks on the client from the view's `now` (`34 sec ago`, or `14 min` with `ago={false}`); the
 * server renders the value at `now`, so the markup hydrates unchanged.
 */
export function LiveAge({ seconds, now, ago = true }: { seconds: number; now: string; ago?: boolean }) {
  const since = isoBefore(now, seconds);
  const s = useAgeTicker(since, now);
  return <time dateTime={since}>{ago ? fmtAgo(s) : fmtDur(s)}</time>;
}

/** A block title row: the heading on the left, a muted aside on the right. */
export function BlockHead({ id, title, aside }: { id: string; title: string; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 id={id} className="m-0 text-[17px] font-semibold tracking-[-0.005em]">
        {title}
      </h2>
      {aside && <span className="text-right text-[13px] text-muted">{aside}</span>}
    </div>
  );
}

/** A bordered white group card with the tinted head row. */
export function GroupCard({
  labelledBy,
  className,
  children,
}: {
  labelledBy: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={cx("mb-4 overflow-hidden rounded-lg border border-line bg-panel", className)}
    >
      {children}
    </section>
  );
}

export function GroupHead({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line bg-(--d-head) px-5 py-3.5 max-[600px]:px-3.5">
      {children}
    </div>
  );
}
