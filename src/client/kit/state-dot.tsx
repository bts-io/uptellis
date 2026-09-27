import { cx } from "./cx";
import type { StateDotProps } from "./props";
import { isHollow, stateTone, TEXT } from "./tone";

/** 8px dot in the state's colour; stale, paused and unknown are hollow rings; `pulse` adds a ping ring. */
export function StateDot({ state, pulse = false, label }: StateDotProps) {
  const hollow = isHollow(state);
  return (
    <span
      role="img"
      aria-label={label ?? state}
      data-state={state}
      className={cx(
        "relative inline-block size-2 shrink-0 rounded-full",
        TEXT[stateTone(state)],
        hollow ? "shadow-[inset_0_0_0_1.5px_currentColor]" : "bg-current",
      )}
    >
      {pulse && !hollow && (
        <span
          aria-hidden="true"
          className="absolute -inset-px rounded-full border-[1.5px] border-current motion-safe:animate-kit-ping"
        />
      )}
    </span>
  );
}
