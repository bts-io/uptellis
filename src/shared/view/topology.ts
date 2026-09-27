/**
 * Topology from the config's nodes and edges plus the live facts of the `forgejo`, `replication`, `fence`
 * and `watchdog` groups (profiles/forgejo-ha/push-facts.sh). The reporting node (`forgejo.node`) tells its own
 * Postgres role (`replication.role`) and names its peer (`replication.peer`, role from `fence.peerRole`).
 * A node whose deciding fact is past its `freshForS`, or whose source is stale, shows `stale`. A node no fact
 * speaks for (e.g. a runner) takes the worst state of the monitors that target it (`runner-1`,
 * `runner-1:22`), and stays `unknown` only when nothing checks it.
 */
import type { SiteConfig } from "../config";
import type { Fact } from "../model";
import { factFresh } from "./facts";
import { formatDuration } from "./format";
import { worstState } from "./state";
import type { DisplayState, Level, TopologyView } from "./types";

export interface TopologyInput {
  topology: SiteConfig["topology"];
  /** Current facts by `group.key`. */
  facts: ReadonlyMap<string, Fact>;
  nowMs: number;
  /** True when the source's data is stale or has never arrived. */
  sourceStale: (sourceId: string) => boolean;
  /** Service views (display state already stale-aware), for nodes no fact describes. */
  services?: readonly { targetDisplay: string | null; state: DisplayState }[];
}

type Node = TopologyView["nodes"][number];

export function buildTopology({
  topology,
  facts,
  nowMs,
  sourceStale,
  services = [],
}: TopologyInput): TopologyView | null {
  if (!topology) return null;
  const fact = (key: string) => facts.get(key);
  const current = (f: Fact | undefined) => !!f && factFresh(f, nowMs) && !sourceStale(f.source);
  const str = (key: string) => {
    const v = fact(key)?.value;
    return v?.type === "string" ? v.value : null;
  };
  const num = (key: string) => {
    const v = fact(key)?.value;
    return v?.type === "number" ? v.value : null;
  };
  const bool = (key: string) => {
    const v = fact(key)?.value;
    return v?.type === "boolean" ? v.value : null;
  };
  /** `state` when the deciding fact is current, else `stale` (or `unknown` when it never arrived). */
  const from = (key: string, state: DisplayState): DisplayState =>
    !fact(key) ? "unknown" : current(fact(key)) ? state : "stale";

  const serving = str("forgejo.servingNode");
  const reporter = str("forgejo.node");
  const role = str("replication.role");
  const peer = str("replication.peer");
  const peerRole =
    str("fence.peerRole") ?? (role === "primary" ? "standby" : role === "standby" ? "primary" : null);
  const standby = role === "standby" ? reporter : peerRole === "standby" ? peer : null;
  const primary = role === "primary" ? reporter : peerRole === "primary" ? peer : null;
  const replState = str("replication.state");
  const streaming = replState === "streaming" && current(fact("replication.state"));

  const healthz =
    bool("forgejo.healthzOk") ??
    (num("forgejo.healthzCode") === null ? null : num("forgejo.healthzCode") === 200);
  const servingState = (): DisplayState => from("forgejo.servingNode", healthz === false ? "down" : "up");
  const standbyState = (): DisplayState => {
    if (standby === reporter) return from("forgejo.node", "up");
    if (bool("replication.peerReachable") === false) return from("replication.peerReachable", "down");
    if (streaming) return "up";
    if (fact("replication.state")) return from("replication.state", "degraded");
    return from("replication.peerReachable", "up");
  };
  const watchdogState = (): DisplayState => {
    const reachable = bool("watchdog.reachable");
    return reachable === null ? "unknown" : from("watchdog.reachable", reachable ? "up" : "down");
  };

  /** Host part of a target: `runner-1:22` and `runner-1/path` both name `runner-1`. */
  const hostOf = (target: string) => target.split(/[:/]/, 1)[0]?.toLowerCase();
  const monitoredState = (node: string): DisplayState =>
    worstState(
      services
        .filter((s) => s.targetDisplay && hostOf(s.targetDisplay) === node.toLowerCase())
        .map((s) => s.state),
    );

  const nodes: Node[] = topology.nodes.map((n) => {
    const base = { id: n.id, label: n.label, roles: n.roles, location: n.location ?? null };
    if (n.id === serving) return { ...base, state: servingState(), note: "serving" };
    if (n.id === standby) return { ...base, state: standbyState(), note: "standby" };
    if (n.id === primary) return { ...base, state: from("replication.role", "up"), note: "primary" };
    if (n.id === reporter) return { ...base, state: from("forgejo.node", "up"), note: n.roles[0] ?? null };
    if (n.roles.includes("watchdog")) return { ...base, state: watchdogState(), note: "watchdog" };
    return { ...base, state: monitoredState(n.id), note: n.roles[0] ?? null };
  });
  const stateOf = new Map(nodes.map((n) => [n.id, n.state]));

  const lag = num("replication.lagSeconds");
  const replicationDetail =
    lag !== null && current(fact("replication.lagSeconds"))
      ? `lag ${formatDuration(lag)}`
      : replState === "none"
        ? "no standby streaming"
        : replState && replState !== "streaming"
          ? replState
          : null;

  const decision = str("fence.decision");
  const fenceLevel: Level = decision === "serve" ? "ok" : "crit";
  return {
    nodes,
    edges: topology.edges.map((e) => {
      const replication = e.kind === "replication";
      return {
        from: e.from,
        to: e.to,
        kind: e.kind,
        label: e.label ?? null,
        // Other edges carry no fact of their own: they flow while both ends are up.
        live: replication ? streaming : stateOf.get(e.from) === "up" && stateOf.get(e.to) === "up",
        detail: replication ? replicationDetail : null,
      };
    }),
    fence: decision === null ? null : { decision, reason: str("fence.reason"), level: fenceLevel },
  };
}
