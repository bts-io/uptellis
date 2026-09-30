import type { ReactNode } from "react";
import { useAgeTicker } from "@/client/effects";
import type { DisplayState } from "@/shared/view";
import { ago, cx, isoBefore, STATE_WORD } from "./format";

/** State text colours (the class names spelled out in full for Tailwind's scanner). */
export const STATE_TEXT: Record<DisplayState, string> = {
  up: "text-up",
  degraded: "text-degraded",
  pending: "text-degraded",
  down: "text-down",
  maintenance: "text-maint",
  paused: "text-stale",
  unknown: "text-stale",
  stale: "text-stale",
};

// Small inline glyphs so a state never relies on colour alone.
function Glyph({ state }: { state: DisplayState }) {
  const common = {
    viewBox: "0 0 16 16",
    "aria-hidden": true,
    className: "size-[0.8rem] flex-none",
    fill: "none",
    stroke: "currentColor",
  } as const;
  switch (state) {
    case "up":
      return (
        <svg {...common}>
          <path d="M3 8.5l3 3 7-7" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "down":
      return (
        <svg {...common}>
          <path d="M4 4l8 8M12 4l-8 8" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
    case "degraded":
    case "pending":
      return (
        <svg {...common}>
          <path d="M8 2l6.5 12h-13z" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M8 6.5v3.5" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "maintenance":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" strokeWidth="1.8" />
          <path d="M8 4.5V8l2.5 1.5" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" strokeWidth="1.8" strokeDasharray="3 2.4" />
        </svg>
      );
  }
}

/** "✓ OPERATIONAL": small caps sans with a glyph, coloured by state. */
export function StateTag({
  state,
  children,
  className,
}: {
  state: DisplayState;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-state={state}
      className={cx(
        "inline-flex items-center gap-[0.35rem] font-sans text-[0.75rem] font-semibold tracking-[0.06em] whitespace-nowrap uppercase",
        STATE_TEXT[state],
        className,
      )}
    >
      <Glyph state={state} />
      {STATE_WORD[state]}
      {children}
    </span>
  );
}

/** "34 seconds ago", ticking every 15 s on the client from the view's age at `now`. */
export function AgeText({ ageS, now }: { ageS: number | null; now: string }) {
  const s = useAgeTicker(isoBefore(now, ageS ?? 0), now, 15_000);
  return <span>{ago(ageS === null ? null : s)}</span>;
}

/** A small-caps part head with a muted aside: "THE SERVICES   8 of 8 operational". */
export function PartHead({ id, title, aside }: { id: string; title: string; aside?: ReactNode }) {
  return (
    <h2
      id={id}
      className="m-0 mb-1 flex justify-between gap-4 border-b-2 border-(--e-rule-strong) pb-2 font-sans text-[0.8rem] font-semibold tracking-[0.14em] uppercase"
    >
      {title}
      {aside && <span className="font-medium tracking-[0.06em] text-muted">{aside}</span>}
    </h2>
  );
}
