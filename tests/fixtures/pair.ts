/**
 * A forgejo-ha pair with a pusher on each node (facts:app-1 and facts:app-2) on the default fixture, in the
 * shapes profiles/forgejo-ha/push-facts.sh sends: the primary's report and the standby's.
 */
import type { Fact, Source } from "../../src/shared/model";
import { buildSiteView, type SiteView, type ViewInput } from "../../src/shared/view";
import { fixtureInput } from "./view";

export const NOW = Date.parse("2026-09-27T23:58:00Z");
const FRESH_FOR_S = 1800;

type Raw = [
  group: string,
  key: string,
  value: Fact["value"],
  unit?: string | null,
  severity?: Fact["severity"],
];
const s = (value: string): Fact["value"] => ({ type: "string", value });
export const n = (value: number): Fact["value"] => ({ type: "number", value });
const b = (value: boolean): Fact["value"] => ({ type: "boolean", value });
const t = (value: string): Fact["value"] => ({ type: "timestamp", value });

export const facts = (source: string, observedAt: string, raw: Raw[]): Fact[] =>
  raw.map(([group, key, value, unit = null, severity = null]) => ({
    site: "demo",
    source,
    group,
    key,
    value,
    unit,
    severity,
    observedAt,
    freshForS: FRESH_FOR_S,
  }));

/** The primary's report: it serves, its standby streams, it runs the backup. */
export const primary = (node: string, peer: string, source: string, at: string, disk = 16): Fact[] =>
  facts(source, at, [
    ["forgejo", "node", s(node)],
    ["forgejo", "serving", b(true), null, "ok"],
    ["forgejo", "servingNode", s(node)],
    ["forgejo", "version", s("16.0.5")],
    ["forgejo", "healthzCode", n(200), null, "ok"],
    ["forgejo", "healthzOk", b(true), null, "ok"],
    ["replication", "role", s("primary")],
    ["replication", "state", s("streaming"), null, "ok"],
    ["replication", "standbyConnected", b(true), null, "ok"],
    ["replication", "lagSeconds", n(0), "s"],
    ["replication", "peer", s(peer)],
    ["replication", "peerReachable", b(true), null, "ok"],
    ["fence", "decision", s("serve"), null, "ok"],
    ["fence", "reason", s("peer is a standby")],
    ["fence", "timeline", n(1)],
    ["fence", "peerRole", s("standby")],
    ["fence", "peerTimeline", n(1)],
    ["backup", "lastAt", t("2026-09-27T23:31:44Z")],
    ["backup", "lastResult", s("ok"), null, "ok"],
    ["backup", "snapshot", s("5e7d0a42")],
    ["backup", "nextAt", t("2026-09-28T23:30:00Z")],
    ["disk", "usedBytes", n(12884901888), "bytes"],
    ["disk", "sizeBytes", n(84825604096), "bytes"],
    ["disk", "percent", n(disk), "%", "ok"],
    ["disk", "display", s(`12G / 79G (${disk}%)`)],
    ["watchdog", "reachable", b(true), null, "ok"],
    ["watchdog", "httpCode", n(200)],
  ]);

/** The standby's report: Forgejo idle, the peer serves, no backup of its own, its own disk. */
export const standby = (node: string, peer: string, source: string, at: string, disk = 12): Fact[] =>
  facts(source, at, [
    ["forgejo", "node", s(node)],
    ["forgejo", "serving", b(false), null, "ok"],
    ["forgejo", "servingNode", s(peer)],
    ["forgejo", "healthzCode", n(200), null, "ok"],
    ["forgejo", "healthzOk", b(true), null, "ok"],
    ["replication", "role", s("standby")],
    ["replication", "standbyConnected", b(false), null, "warn"],
    ["replication", "peer", s(peer)],
    ["replication", "peerReachable", b(false), null, "warn"],
    ["fence", "timeline", n(1)],
    ["fence", "peerRole", s("primary")],
    ["fence", "peerTimeline", n(1)],
    ["backup", "lastResult", s("none"), null, "warn"],
    ["backup", "nextScheduled", b(false), null, "warn"],
    ["disk", "usedBytes", n(9663676416), "bytes"],
    ["disk", "sizeBytes", n(84825604096), "bytes"],
    ["disk", "percent", n(disk), "%", "ok"],
    ["disk", "display", s(`9G / 79G (${disk}%)`)],
    ["watchdog", "reachable", b(true), null, "ok"],
    ["watchdog", "httpCode", n(200)],
  ]);

const source = (id: string, lastSeenAt: string): Source => ({
  id,
  site: "demo",
  kind: "facts",
  expectedIntervalS: 900,
  lastSeenAt,
  lastOkAt: lastSeenAt,
});

/** The default fixture with both nodes pushing: `pair` replaces the facts of facts:app-1. */
export function pairView(pair: Fact[], seen: Record<string, string> = {}): SiteView {
  const input: ViewInput = fixtureInput("default");
  const at = (id: string) =>
    seen[id] ??
    pair.filter((f) => f.source === id).reduce((m, f) => (f.observedAt > m ? f.observedAt : m), "");
  input.config = {
    ...input.config,
    sources: [...input.config.sources, { id: "facts:app-2", kind: "facts", expectedIntervalS: 900 }],
  };
  input.model = {
    ...input.model,
    sources: [
      ...input.model.sources.filter((x) => x.id !== "facts:app-1"),
      source("facts:app-1", at("facts:app-1")),
      source("facts:app-2", at("facts:app-2")),
    ],
    facts: [...input.model.facts.filter((f) => f.source === "kuma:watch-1"), ...pair],
  };
  return buildSiteView(input);
}
