/**
 * `StatePill`: a state as an icon plus a word, in the state's colour (never colour alone). Covers every
 * `DisplayState`; the words are plain (`stale` reads "No recent data").
 *
 *   <StatePill state="down" />                 small, for tables and lists
 *   <StatePill state="pending" size="lg" />    large, for a drawer's heading
 *
 * `STATE_WORD` is exported for sentences and screen-reader text that name a state without the pill.
 */
import type { DisplayState } from "@/shared/view";
import { cx } from "../../kit/cx";
import { BORDER, stateTone, TEXT } from "../../kit/tone";
import { AdminIcon, type AdminIconName } from "./icons";

export const STATE_WORD: Record<DisplayState, string> = {
  up: "Up",
  down: "Down",
  degraded: "Degraded",
  pending: "Pending",
  maintenance: "Maintenance",
  paused: "Paused",
  unknown: "Unknown",
  stale: "No recent data",
};

const STATE_ICON: Record<DisplayState, AdminIconName> = {
  up: "up",
  down: "down",
  degraded: "degraded",
  pending: "pending",
  maintenance: "maintenance",
  paused: "paused",
  unknown: "stale",
  stale: "stale",
};

export function StatePill({ state, size = "sm" }: { state: DisplayState; size?: "sm" | "lg" }) {
  const tone = stateTone(state);
  return (
    <span
      data-state={state}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap",
        TEXT[tone],
        BORDER[tone],
        size === "lg" ? "px-3 py-1 text-base" : "px-2 py-0.5 text-xs",
      )}
    >
      <AdminIcon name={STATE_ICON[state]} size={size === "lg" ? 20 : 14} />
      {STATE_WORD[state]}
    </span>
  );
}
