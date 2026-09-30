import type { DisplayState, Level, VerdictState } from "@/shared/view";

/**
 * Which semantic colour a state or level uses. The class maps spell every class out in full so Tailwind's
 * scanner sees them.
 */
export type Tone = "up" | "degraded" | "down" | "maint" | "stale" | "muted";

export const TEXT: Record<Tone, string> = {
  up: "text-up",
  degraded: "text-degraded",
  down: "text-down",
  maint: "text-maint",
  stale: "text-stale",
  muted: "text-muted",
};

export const BORDER: Record<Tone, string> = {
  up: "border-up",
  degraded: "border-degraded",
  down: "border-down",
  maint: "border-maint",
  stale: "border-stale",
  muted: "border-muted",
};

export function stateTone(state: DisplayState): Tone {
  switch (state) {
    case "up":
      return "up";
    case "down":
      return "down";
    case "degraded":
    case "pending":
      return "degraded";
    case "maintenance":
      return "maint";
    case "stale":
      return "stale";
    default:
      return "muted";
  }
}

/** States drawn as a hollow ring: nothing current to vouch for (stale, paused, unknown). */
export const isHollow = (state: DisplayState) => stateTone(state) === "stale" || stateTone(state) === "muted";

export const LEVEL_TONE: Record<Level, Tone> = { ok: "up", warn: "degraded", crit: "down", info: "muted" };

export const VERDICT_TONE: Record<VerdictState, Tone> = {
  operational: "up",
  degraded: "degraded",
  outage: "down",
  maintenance: "maint",
  stale: "stale",
  empty: "muted",
};
