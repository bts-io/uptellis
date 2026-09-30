import type { ReactNode } from "react";
import { useAgeTicker } from "@/client/effects";
import type { DisplayState, Level } from "@/shared/view";
import { ago, cx, dur, isoBefore, WORD } from "./format";

const DOT: Record<DisplayState, string> = {
  up: "bg-up",
  degraded: "bg-degraded",
  pending: "bg-degraded",
  down: "bg-down",
  maintenance: "bg-maint",
  paused: "bg-transparent shadow-[inset_0_0_0_1.5px_var(--color-stale)]",
  unknown: "bg-transparent shadow-[inset_0_0_0_1.5px_var(--color-stale)]",
  stale: "bg-transparent shadow-[inset_0_0_0_1.5px_var(--color-stale)]",
};

const WORD_TEXT: Partial<Record<DisplayState, string>> = {
  down: "font-semibold text-(--i-down-text)",
  maintenance: "text-(--i-maint-text)",
};

export const LEVEL_STATE: Record<Level, DisplayState> = {
  ok: "up",
  warn: "degraded",
  crit: "down",
  info: "unknown",
};

/** A small dot and the state word (colour is never the only cue). */
export function State({ state, label }: { state: DisplayState; label?: string }) {
  return (
    <span
      data-s={state}
      className={cx(
        "inline-flex items-center gap-[7px] justify-self-end text-[13px] whitespace-nowrap text-muted",
        WORD_TEXT[state],
      )}
    >
      <i aria-hidden="true" className={cx("size-[7px] rounded-full", DOT[state])} />
      {label ?? WORD[state]}
    </span>
  );
}

/** Small uppercase block label. */
export function Label({
  as: As = "h2",
  id,
  className,
  children,
}: {
  as?: "h2" | "h3";
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <As
      id={id}
      className={cx(
        "m-0 mb-2.5 text-[11.5px] font-semibold tracking-[0.08em] text-faint uppercase",
        className,
      )}
    >
      {children}
    </As>
  );
}

/**
 * An age that ticks on the client from the view's `now` (`34s ago`, or `14 min` with `suffix={false}`); the
 * server renders the value at `now`, so the markup hydrates unchanged.
 */
export function LiveAge({ seconds, now, suffix = true }: { seconds: number; now: string; suffix?: boolean }) {
  const since = isoBefore(now, seconds);
  const s = useAgeTicker(since, now);
  return <time dateTime={since}>{suffix ? ago(s) : dur(s)}</time>;
}
