/**
 * forgejo-ha: a self-hosted Forgejo on two nodes with streaming Postgres replication and a fence, as
 * `profiles/forgejo-ha/push-facts.sh` reports it (groups forgejo, replication, fence, backup, runners, disk,
 * watchdog). Labels, formats, levels and thresholds (`config.thresholds`) are those of the facts; the
 * topology hook finds the serving node, the standby and primary, the reporter and the watchdog.
 */
import type { Fact } from "../model";
import { formatBytes, formatDuration, formatRelative, toMs } from "../view/format";
import type { DisplayState, Level, TopologyView } from "../view/types";
import { bool, current, num, own, str } from "./read";
import type { FactKeyDef, Profile, ProfileContext } from "./types";

/** Seconds from a timestamp fact's value to now (negative when it lies ahead). */
const sinceS = (f: Fact, ctx: ProfileContext) =>
  f.value.type === "timestamp" ? (ctx.nowMs - toMs(f.value.value)) / 1000 : null;

/** A boolean key that is `ok` when true and `whenFalse` when false. */
const flag = (
  key: string,
  label: string,
  whenFalse: Level,
  labels?: readonly [string, string],
): FactKeyDef => ({
  key,
  label,
  format: "bool",
  labels,
  level: (f) => {
    const v = own.bool(f);
    return v === null ? null : v ? "ok" : whenFalse;
  },
});

/** Text of a fact for a summary line, or null when the fact is missing. */
const text = (ctx: ProfileContext, key: string) => {
  const f = ctx.facts.get(key);
  if (!f) return null;
  const v = f.value;
  return v.type === "boolean" ? (v.value ? "yes" : "no") : String(v.value);
};

const lagDisplay = (ctx: ProfileContext) => {
  const lag = num(ctx, "replication.lagSeconds");
  return lag === null ? null : formatDuration(lag);
};

const httpCode = (code: number) => `HTTP ${code}`;

/** Replication streams only while its state says so and the fact is current. */
const streaming = (ctx: ProfileContext) =>
  str(ctx, "replication.state") === "streaming" && current(ctx, ctx.facts.get("replication.state"));

/** `lag 0 s` while the lag is current, else why nothing streams; null when nothing is known. */
const replicationDetail = (ctx: ProfileContext) => {
  const lag = lagDisplay(ctx);
  const state = str(ctx, "replication.state");
  return lag !== null && current(ctx, ctx.facts.get("replication.lagSeconds"))
    ? `lag ${lag}`
    : state === "none"
      ? "no standby streaming"
      : state && state !== "streaming"
        ? state
        : null;
};

const watchdogText = (ctx: ProfileContext) => {
  const reachable = bool(ctx, "watchdog.reachable");
  if (reachable === null) return null;
  const code = num(ctx, "watchdog.httpCode");
  const t = reachable ? "reachable" : "unreachable";
  return code === null ? t : `${t} (${httpCode(code)})`;
};

/** "watch-1 online, runner-1 offline" -> "watch-1 (online), runner-1 (offline)" */
const runnerList = (list: string) =>
  list
    .split(", ")
    .map((item) => {
      const at = item.lastIndexOf(" ");
      return at > 0 ? `${item.slice(0, at)} (${item.slice(at + 1)})` : item;
    })
    .join(", ");

/** Seconds since a timestamp fact by key, or null. */
const ageOf = (ctx: ProfileContext, key: string) => {
  const f = ctx.facts.get(key);
  return f ? sinceS(f, ctx) : null;
};

/** Postgres as the dashboards name it: a standby is a replica. */
const pgRole = (role: string) => (role === "standby" ? "replica" : role);

const join = (parts: (string | null | false)[]) => parts.filter(Boolean).join(" · ") || null;

export const forgejoHa: Profile = {
  id: "forgejo-ha",
  name: "Forgejo HA",
  description:
    "A Forgejo failover pair: serving node, Postgres replication, the fence, backups, runners, disk and the external watchdog.",
  groups: [
    {
      id: "forgejo",
      title: "Forgejo",
      icon: "server",
      order: 10,
      keys: [
        {
          key: "servingNode",
          label: "Serving node",
          format: "text",
          level: (f) => (own.str(f) === "none" ? "crit" : null),
        },
        { key: "version", label: "Version", format: "text" },
        {
          key: "healthzCode",
          label: "Health check",
          format: "number",
          display: (f) => {
            const code = own.num(f);
            return code === null ? null : httpCode(code);
          },
          level: (f) => {
            const code = own.num(f);
            return code === null ? null : code === 200 ? "ok" : "crit";
          },
        },
        { ...flag("healthzOk", "Healthy", "crit"), foldedInto: "healthzCode" },
        { key: "node", label: "Reporting node", format: "text" },
        { key: "serving", label: "Running on reporting node", format: "bool" },
      ],
      summary: (ctx) => {
        const code = num(ctx, "forgejo.healthzCode");
        const serving = str(ctx, "forgejo.servingNode");
        return join([
          text(ctx, "forgejo.version"),
          code !== null && httpCode(code),
          serving !== null && `serving ${serving}`,
        ]);
      },
    },
    {
      id: "replication",
      title: "Replication",
      icon: "database",
      order: 20,
      keys: [
        {
          key: "state",
          label: "State",
          format: "text",
          level: (f) => (own.str(f) === "streaming" ? "ok" : "warn"),
        },
        {
          key: "lagSeconds",
          label: "Lag",
          format: "duration",
          level: (f, ctx) => {
            const lag = own.num(f);
            const t = ctx.config.thresholds;
            return lag === null ? null : lag > t.lagCritS ? "crit" : lag > t.lagWarnS ? "warn" : "ok";
          },
        },
        { key: "role", label: "Reporting node role", format: "text" },
        { key: "peer", label: "Peer", format: "text" },
        flag("peerReachable", "Peer reachable", "warn"),
        flag("standbyConnected", "Standby connected", "warn"),
      ],
      summary: (ctx) => {
        const state = str(ctx, "replication.state");
        const lag = lagDisplay(ctx);
        const peer = str(ctx, "replication.peer");
        const reachable = text(ctx, "replication.peerReachable");
        return join([
          [state, lag && `lag ${lag}`].filter(Boolean).join(" ") || null,
          str(ctx, "replication.role"),
          peer && `peer ${peer}${reachable ? ` (reachable ${reachable})` : ""}`,
        ]);
      },
    },
    {
      id: "fence",
      title: "Fence",
      icon: "shield",
      order: 30,
      keys: [
        {
          key: "decision",
          label: "Decision",
          format: "text",
          level: (f) => (own.str(f) === "serve" ? "ok" : "crit"),
        },
        { key: "reason", label: "Reason", format: "text" },
        { key: "timeline", label: "Timeline", format: "number" },
        { key: "peerRole", label: "Peer role", format: "text" },
        {
          key: "peerTimeline",
          label: "Peer timeline",
          format: "number",
          level: (f, ctx) => {
            const ours = num(ctx, "fence.timeline");
            return ours !== null && own.num(f) !== ours ? "warn" : null;
          },
        },
      ],
      summary: (ctx) => {
        const timeline = text(ctx, "fence.timeline");
        const peerRole = str(ctx, "fence.peerRole");
        return join([
          str(ctx, "fence.decision")?.toUpperCase() ?? null,
          timeline && `timelines ${timeline}/${text(ctx, "fence.peerTimeline") ?? "-"}`,
          str(ctx, "fence.reason"),
          peerRole && `peer ${peerRole}`,
        ]);
      },
    },
    {
      id: "backup",
      title: "Backup",
      icon: "box",
      order: 40,
      keys: [
        {
          key: "lastAt",
          label: "Last backup",
          format: "age",
          level: (f, ctx) => {
            const age = sinceS(f, ctx);
            return age === null ? null : age > ctx.config.thresholds.backupMaxAgeH * 3600 ? "crit" : "ok";
          },
        },
        {
          key: "lastResult",
          label: "Result",
          format: "text",
          display: (f) => (own.str(f) === "none" ? "no backup yet" : null),
          level: (f) => {
            const v = own.str(f);
            return v === "ok" ? "ok" : v === "none" ? "warn" : "crit";
          },
        },
        { key: "failedStep", label: "Failed step", format: "text", level: () => "crit" },
        {
          key: "nextAt",
          label: "Next backup",
          format: "until",
          level: (f, ctx) => {
            const since = sinceS(f, ctx);
            return since !== null && since >= 0 ? "warn" : null;
          },
        },
        flag("nextScheduled", "Scheduled", "warn", ["yes", "not scheduled"]),
        { key: "snapshot", label: "Snapshot", format: "text" },
        { key: "size", label: "Size", format: "bytes" },
        { key: "durationS", label: "Duration", format: "duration" },
      ],
      summary: (ctx) => {
        const result = str(ctx, "backup.lastResult");
        const last = ageOf(ctx, "backup.lastAt");
        const next = ageOf(ctx, "backup.nextAt");
        const size = num(ctx, "backup.size");
        const took = num(ctx, "backup.durationS");
        const failed = str(ctx, "backup.failedStep");
        return join([
          str(ctx, "backup.snapshot"),
          last !== null && formatRelative(Math.max(0, last)),
          [
            size !== null ? formatBytes(size) : str(ctx, "backup.size"),
            took !== null && `in ${formatDuration(took)}`,
          ]
            .filter(Boolean)
            .join(" ") || null,
          result === "none" ? "no backup yet" : result,
          failed && `failed at ${failed}`,
          next !== null && `next ${next >= 0 ? "due now" : formatRelative(next)}`,
        ]);
      },
    },
    {
      id: "runners",
      title: "Runners",
      icon: "bolt",
      order: 50,
      keys: [
        {
          key: "online",
          label: "Online",
          format: "number",
          display: (f, ctx) => {
            const online = own.num(f);
            const total = num(ctx, "runners.total");
            return online === null || total === null ? null : `${online} of ${total}`;
          },
          level: (f, ctx) => {
            const online = own.num(f);
            const total = num(ctx, "runners.total");
            return online === null || total === null ? null : online < total ? "warn" : "ok";
          },
        },
        { key: "total", label: "Total", format: "number", foldedInto: "online" },
        {
          key: "offline",
          label: "Offline",
          format: "text",
          level: (f) => (own.str(f) === "none" ? null : "warn"),
        },
        {
          key: "list",
          label: "Runners",
          format: "list",
          // "watch-1 online, runner-1 offline" -> "watch-1 (online), runner-1 (offline)"
          display: (f) => {
            const v = own.str(f);
            return v === null ? null : runnerList(v);
          },
        },
      ],
      summary: (ctx) => {
        const online = num(ctx, "runners.online");
        const total = num(ctx, "runners.total");
        const offline = str(ctx, "runners.offline");
        const list = str(ctx, "runners.list");
        return join([
          online !== null && (total !== null ? `${online} of ${total} online` : `${online} online`),
          offline !== null && offline !== "none" && `offline ${offline}`,
          list && runnerList(list),
        ]);
      },
    },
    {
      id: "disk",
      title: "Disk",
      icon: "host",
      order: 60,
      keys: [
        {
          key: "percent",
          label: "Root filesystem",
          format: "percent",
          level: (f) => {
            const p = own.num(f);
            return p === null ? null : p >= 90 ? "crit" : p >= 80 ? "warn" : "ok";
          },
        },
        { key: "display", label: "Used", format: "text" },
        { key: "usedBytes", label: "Used", format: "bytes", foldedInto: "display" },
        { key: "sizeBytes", label: "Size", format: "bytes", foldedInto: "display" },
      ],
      summary: (ctx) => {
        const used = num(ctx, "disk.usedBytes");
        const size = num(ctx, "disk.sizeBytes");
        const percent = num(ctx, "disk.percent");
        return (
          str(ctx, "disk.display") ??
          join([
            used !== null && size !== null && `${formatBytes(used)} / ${formatBytes(size)}`,
            percent !== null && `${percent}%`,
          ])
        );
      },
    },
    {
      id: "watchdog",
      title: "Watchdog",
      icon: "eye",
      order: 70,
      keys: [
        {
          key: "reachable",
          label: "Status page",
          format: "bool",
          display: (_f, ctx) => watchdogText(ctx),
          level: (f) => {
            const v = own.bool(f);
            return v === null ? null : v ? "ok" : "warn";
          },
        },
        { key: "httpCode", label: "HTTP status", format: "number", foldedInto: "reachable" },
      ],
      summary: watchdogText,
    },
  ],
  highlights: [{ fact: "watchdog.reachable", label: "watchdog" }],
  headline: (ctx) => {
    const serving = str(ctx, "forgejo.servingNode");
    if (serving === null) return null;
    const paired = ctx.config.topology?.edges.some((e) => e.kind === "replication");
    const replication = !paired
      ? null
      : streaming(ctx)
        ? `replication ${str(ctx, "replication.state")}`
        : (replicationDetail(ctx) ?? "replication stopped");
    return [`Forgejo serving from ${serving}`, replication].filter(Boolean).join(", ");
  },
  topology: refineTopology,
  producerGuide: "profiles/forgejo-ha/README.md",
};

type Node = TopologyView["nodes"][number];
type Detail = Node["details"][number];

/**
 * The reporting node (`forgejo.node`) tells its own Postgres role (`replication.role`) and names its peer
 * (`replication.peer`, role from `fence.peerRole`). A node whose deciding fact is past its `freshForS`, or
 * whose source is stale, shows `stale`; one whose fact never arrived shows `unknown`.
 */
function refineTopology(ctx: ProfileContext, topology: TopologyView): TopologyView {
  const fact = (key: string) => ctx.facts.get(key);
  /** `state` when the deciding fact is current, else `stale` (or `unknown` when it never arrived). */
  const from = (key: string, state: DisplayState): DisplayState =>
    !fact(key) ? "unknown" : current(ctx, fact(key)) ? state : "stale";

  const serving = str(ctx, "forgejo.servingNode");
  const reporter = str(ctx, "forgejo.node");
  const role = str(ctx, "replication.role");
  const peer = str(ctx, "replication.peer");
  const peerRole =
    str(ctx, "fence.peerRole") ?? (role === "primary" ? "standby" : role === "standby" ? "primary" : null);
  const standby = role === "standby" ? reporter : peerRole === "standby" ? peer : null;
  const primary = role === "primary" ? reporter : peerRole === "primary" ? peer : null;
  const live = streaming(ctx);

  const healthzCode = num(ctx, "forgejo.healthzCode");
  const healthz = bool(ctx, "forgejo.healthzOk") ?? (healthzCode === null ? null : healthzCode === 200);
  const servingState = (): DisplayState => from("forgejo.servingNode", healthz === false ? "down" : "up");
  const standbyState = (): DisplayState => {
    if (standby === reporter) return from("forgejo.node", "up");
    if (bool(ctx, "replication.peerReachable") === false) return from("replication.peerReachable", "down");
    if (live) return "up";
    if (fact("replication.state")) return from("replication.state", "degraded");
    return from("replication.peerReachable", "up");
  };
  const watchdogState = (): DisplayState => {
    const reachable = bool(ctx, "watchdog.reachable");
    return reachable === null ? "unknown" : from("watchdog.reachable", reachable ? "up" : "down");
  };

  const lag = lagDisplay(ctx);
  const lagCurrent = lag !== null && current(ctx, fact("replication.lagSeconds"));
  const disk = num(ctx, "disk.percent");

  /** The rows of a pair node's card: forgejo, postgres, then the disk (reporter) or the WAL stream (peer). */
  const pairDetails = (n: Node): Detail[] => {
    const forgejo: Detail =
      n.note === "serving"
        ? { label: "forgejo", value: n.state === "down" ? "down" : "serving", state: n.state }
        : { label: "forgejo", value: "idle", state: "paused" };
    const postgres: Detail =
      n.id === reporter
        ? { label: "postgres", value: role ? pgRole(role) : "-", state: role ? "up" : "unknown" }
        : {
            label: "postgres",
            value:
              n.state === "down"
                ? "down"
                : n.state === "degraded"
                  ? "not streaming"
                  : n.state === "unknown"
                    ? "-"
                    : pgRole(n.note === "serving" ? "primary" : (n.note ?? "standby")),
            state: n.state,
          };
    const last: Detail | null =
      n.id === reporter
        ? disk === null
          ? null
          : { label: "disk", value: `${disk}%`, state: disk >= 90 ? "down" : disk >= 80 ? "degraded" : "up" }
        : {
            label: "wal",
            value: live ? (lagCurrent ? `lag ${lag}` : "live") : "stopped",
            state: live ? "up" : "down",
          };
    return [forgejo, postgres, ...(last ? [last] : [])];
  };

  const nodes = topology.nodes.map((n): Node => {
    const at = (state: DisplayState, note: string | null): Node => ({ ...n, state, note });
    const pair = (x: Node): Node => ({ ...x, details: pairDetails(x) });
    if (n.id === serving) return pair(at(servingState(), "serving"));
    if (n.id === standby) return pair(at(standbyState(), "standby"));
    if (n.id === primary) return pair(at(from("replication.role", "up"), "primary"));
    if (n.id === reporter) return pair(at(from("forgejo.node", "up"), n.roles[0] ?? null));
    if (n.roles.includes("watchdog")) {
      const status = watchdogText(ctx);
      const x = at(watchdogState(), "watchdog");
      return status ? { ...x, details: [{ label: "status page", value: status, state: x.state }] } : x;
    }
    return n;
  });

  const decision = str(ctx, "fence.decision");
  return {
    nodes,
    edges: topology.edges.map((e) =>
      e.kind === "replication" ? { ...e, live, detail: replicationDetail(ctx) } : e,
    ),
    fence:
      decision === null
        ? topology.fence
        : { decision, reason: str(ctx, "fence.reason"), level: decision === "serve" ? "ok" : "crit" },
  };
}
