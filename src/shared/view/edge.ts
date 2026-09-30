import type { TopologyView } from "./types";

/** What a theme may say about an edge: it flows, the data says it does not, or nothing says either. */
export type EdgeState = "live" | "stopped" | "unknown";

/**
 * An edge's state from the view: `live` while `edge.live`; `stopped` when a profile gave it a detail (e.g.
 * "no standby streaming", or the last lag with its age once the facts are past their window) or an end node
 * is `down` or `degraded`; otherwise `unknown`, since nothing reports on it (no facts yet, a retired facts
 * source, ends that are `unknown` or `stale`). A theme draws `unknown` muted and never counts it as a failure.
 */
export function edgeState(
  edge: TopologyView["edges"][number],
  nodes: readonly Pick<TopologyView["nodes"][number], "id" | "state">[],
): EdgeState {
  if (edge.live) return "live";
  if (edge.detail !== null) return "stopped";
  const failing = [edge.from, edge.to].some((id) => {
    const state = nodes.find((n) => n.id === id)?.state;
    return state === "down" || state === "degraded";
  });
  return failing ? "stopped" : "unknown";
}
