/**
 * Topology from the config's nodes and edges, refined by the active profiles in order (`Profile.topology`).
 * Before the profiles run, a node takes the worst state of the monitors that target it (`runner-1`,
 * `runner-1:22`) and stays `unknown` only when nothing checks it; its note is its first role. After them, an
 * edge no profile touched (the same object) flows while both ends are up.
 */
import type { SiteConfig } from "../config";
import type { Profile, ProfileContext } from "../profiles/types";
import { worstState } from "./state";
import type { DisplayState, TopologyView } from "./types";

export interface TopologyInput {
  topology: SiteConfig["topology"];
  /** Active profiles in order. */
  profiles: readonly Profile[];
  ctx: ProfileContext;
  /** Service views (display state already stale-aware), for nodes no profile describes. */
  services?: readonly { targetDisplay: string | null; state: DisplayState }[];
}

export function buildTopology({
  topology,
  profiles,
  ctx,
  services = [],
}: TopologyInput): TopologyView | null {
  if (!topology) return null;
  /** Host part of a target: `runner-1:22` and `runner-1/path` both name `runner-1`. */
  const hostOf = (target: string) => target.split(/[:/]/, 1)[0]?.toLowerCase();
  const monitoredState = (node: string): DisplayState =>
    worstState(
      services
        .filter((s) => s.targetDisplay && hostOf(s.targetDisplay) === node.toLowerCase())
        .map((s) => s.state),
    );

  const edges: TopologyView["edges"] = topology.edges.map((e) => ({
    from: e.from,
    to: e.to,
    kind: e.kind,
    label: e.label ?? null,
    live: false,
    detail: null,
  }));
  const base: TopologyView = {
    nodes: topology.nodes.map((n) => ({
      id: n.id,
      label: n.label,
      roles: n.roles,
      location: n.location ?? null,
      state: monitoredState(n.id),
      note: n.roles[0] ?? null,
      details: [],
    })),
    edges,
    fence: null,
  };
  const refined = profiles.reduce((t, p) => p.topology?.(ctx, t) ?? t, base);
  const stateOf = new Map(refined.nodes.map((n) => [n.id, n.state]));
  return {
    ...refined,
    fence: refined.fence && { ...refined.fence, detail: refined.fence.detail ?? null },
    edges: refined.edges.map((e) =>
      edges.includes(e) ? { ...e, live: stateOf.get(e.from) === "up" && stateOf.get(e.to) === "up" } : e,
    ),
  };
}
