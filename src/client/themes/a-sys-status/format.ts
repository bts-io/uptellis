import type { DisplayState, Level, ServiceView, SiteView, TopologyView } from "@/shared/view";

/** Shown wherever a value is missing (a fact the collector did not send, a check without latency). */
export const DASH = "-";

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** `HH:MM:SS` of an ISO timestamp (times on this page are UTC). */
export const hhmmss = (ts: string) => ts.slice(11, 19);
export const hhmm = (ts: string) => ts.slice(11, 16);

/** Stale or never reported: every dot on the page goes hollow and values are marked frozen. */
export const isStale = (view: SiteView) =>
  view.freshness.state === "stale" || view.freshness.state === "empty";

/** The facts probe is stale or never reported (infra and hosts age with it, not with the Kuma collector). */
export const probeStale = (view: SiteView) => {
  const probe = view.freshness.perSource.find((s) => s.kind === "facts");
  return probe ? probe.freshness === "stale" || probe.freshness === "empty" : isStale(view);
};

export const LEVEL_TEXT: Record<Level, string> = {
  ok: "text-up",
  warn: "text-degraded",
  crit: "text-down",
  info: "text-muted",
};

export const STATE_TEXT: Record<DisplayState, string> = {
  up: "text-up",
  degraded: "text-degraded",
  pending: "text-degraded",
  down: "text-down",
  maintenance: "text-maint",
  paused: "text-muted",
  unknown: "text-muted",
  stale: "text-muted",
};

/** The dot of a level: ok up, warn degraded, crit down, info unknown. */
export const LEVEL_STATE: Record<Level, DisplayState> = {
  ok: "up",
  warn: "degraded",
  crit: "down",
  info: "unknown",
};

export const healthLevel = (score: number): Level => (score >= 90 ? "ok" : score >= 75 ? "warn" : "crit");
/** Uptime ratio 0..1: green from 99.9%, amber from 99%. */
export const uptimeLevel = (ratio: number): Level =>
  ratio >= 0.999 ? "ok" : ratio >= 0.99 ? "warn" : "crit";

export const pct = (ratio: number | null, digits = 2) =>
  ratio === null ? DASH : (ratio * 100).toFixed(digits);

/** Latency band per check kind: HTTP is slower than TCP or ICMP by nature. */
export function latencyLevel(kind: ServiceView["kind"], ms: number | null): Level {
  // No latency (a timeout, or nothing reported) is not a latency verdict: neutral, not red.
  if (ms === null) return "info";
  const [warn, crit] = kind === "ping" ? [150, 400] : kind === "port" ? [300, 1000] : [600, 1500];
  return ms < warn ? "ok" : ms < crit ? "warn" : "crit";
}

export function checkType(s: ServiceView): string {
  switch (s.kind) {
    case "http":
    case "keyword":
      return s.method ? `HTTP ${s.method}` : "HTTP";
    case "port":
      return "TCP";
    case "ping":
      return "ICMP";
    case "push":
      return "PUSH";
    case "fact":
      return "FACT";
    case "tls":
      return "TLS";
  }
}

/** A service's state as its card label: `LAST UP` once the data is stale. */
export const stateLabel = (s: ServiceView) => (s.state === "stale" ? `last ${s.status}` : s.state);

/** A value that carries a figure (`lag 0 s`, `HTTP 200`) rather than only words (`serving`, `replica`). */
export const isMeasure = (value: string) => /\d/.test(value);

/**
 * The pair tile's caption from the profile: the application its cards lead with (the first row the profile
 * gives a pair node, e.g. `forgejo`), so `forgejo failover pair`; plain `failover pair` when the profile
 * gives no rows, `topology` without a replication pair.
 */
export function pairCaption(topology: TopologyView): string {
  const pair = topology.edges.find((e) => e.kind === "replication");
  if (!pair) return "topology";
  const app = topology.nodes.find((n) => (n.id === pair.from || n.id === pair.to) && n.details.length)
    ?.details[0]?.label;
  return app ? `${app} failover pair` : "failover pair";
}
