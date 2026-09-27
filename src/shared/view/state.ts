import type { DisplayState } from "./types";

/** Worst first. */
const STATE_RANK: Record<DisplayState, number> = {
  down: 0,
  stale: 1,
  degraded: 2,
  pending: 3,
  unknown: 4,
  paused: 5,
  maintenance: 6,
  up: 7,
};

/** The worst of some display states (`unknown` for none). */
export const worstState = (xs: readonly DisplayState[]): DisplayState =>
  xs.length ? xs.reduce((w, s) => (STATE_RANK[s] < STATE_RANK[w] ? s : w)) : "unknown";
