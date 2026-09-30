/**
 * forgejo-ha: a self-hosted Forgejo on two nodes with streaming Postgres replication and a fence, as
 * `profiles/forgejo-ha/push-facts.sh` reports it (groups forgejo, replication, fence, backup, runners, disk,
 * watchdog). Labels, formats, levels and thresholds (`config.thresholds`) are those of the facts; the
 * topology hook finds the serving node, the standby and primary, the reporter and the watchdog.
 */
import type { Fact } from "../model";
import { formatBytes, formatDuration, formatRelative, toMs } from "../view/format";
import type { DisplayState, Level, TopologyView } from "../view/types";
import { bool, current, keyLevel, lastKnown, num, own, part, quiet, runs, staleAge, str } from "./read";
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

/**
 * `lag 0 s` while the lag is current; the last known lag with its age (`lag 0 s, 20 min ago`) once it is
 * past its window, unless the state says why nothing streams; null when nothing is known.
 */
const replicationDetail = (ctx: ProfileContext) => {
  const lag = lagDisplay(ctx);
  const state = str(ctx, "replication.state");
  const lagFact = ctx.facts.get("replication.lagSeconds");
  return lag !== null && (current(ctx, lagFact) || state === null || state === "streaming")
    ? lastKnown(ctx, "replication.lagSeconds", `lag ${lag}`)
    : state === "none"
      ? "no standby streaming"
      : state && state !== "streaming"
        ? state
        : null;
};

/** True when any replication fact arrived (current or stale); none means nothing is known about it. */
const replicationKnown = (ctx: ProfileContext) =>
  ctx.facts.has("replication.state") || ctx.facts.has("replication.lagSeconds");

/**
 * The headline's replication clause: a lag reads "replication lag 0 s, 20 min ago"; null (no clause) when no
 * replication fact ever arrived, since "stopped" is a claim only a fact can make.
 */
const replicationLine = (ctx: ProfileContext, detail: string | null) =>
  detail === null
    ? replicationKnown(ctx)
      ? "replication stopped"
      : null
    : detail.startsWith("lag ")
      ? `replication ${detail}`
      : detail;

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

/** A key's level as its row shows it (`forgejo.healthzCode` -> ok). */
const lvl = (ctx: ProfileContext, key: string) => keyLevel(ctx, forgejoHa.groups, key);

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
      // 16.0.5 · HTTP 200 · serving app-1
      summaryParts: (ctx) => {
        const version = text(ctx, "forgejo.version");
        const code = num(ctx, "forgejo.healthzCode");
        const serving = str(ctx, "forgejo.servingNode");
        return runs(
          [version !== null && part(version)],
          [code !== null && part(httpCode(code), lvl(ctx, "forgejo.healthzCode"))],
          [serving !== null && part(`serving ${serving}`, quiet(lvl(ctx, "forgejo.servingNode")))],
        );
      },
    },
    {
      id: "replication",
      title: "Replication",
      icon: "database",
      order: 20,
      // The pair's replication edge (live, lag) and its card rows (postgres role, wal) carry it.
      inTopology: (t) => t.edges.some((e) => e.kind === "replication"),
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
      // streaming lag 0 s · primary · peer app-2 (reachable yes) · standby connected yes
      summaryParts: (ctx) => {
        const state = str(ctx, "replication.state");
        const lag = lagDisplay(ctx);
        // A lag past its window keeps its number, muted, with its age: "lag 0 s, 20 min ago".
        const lagStale = staleAge(ctx, "replication.lagSeconds") !== null;
        const role = str(ctx, "replication.role");
        const peer = str(ctx, "replication.peer");
        const reachable = text(ctx, "replication.peerReachable");
        const connected = text(ctx, "replication.standbyConnected");
        return runs(
          [
            state !== null && part(state, lvl(ctx, "replication.state"), true),
            lag !== null && part("lag", "info"),
            lag !== null &&
              part(
                lastKnown(ctx, "replication.lagSeconds", lag),
                lagStale ? "info" : lvl(ctx, "replication.lagSeconds"),
              ),
          ],
          [role !== null && part(role, "info")],
          [
            peer !== null && part(`peer ${peer}`, "info"),
            peer !== null &&
              reachable !== null &&
              part(`(reachable ${reachable})`, quiet(lvl(ctx, "replication.peerReachable"))),
          ],
          [
            connected !== null &&
              part(`standby connected ${connected}`, quiet(lvl(ctx, "replication.standbyConnected"))),
          ],
        );
      },
    },
    {
      id: "fence",
      title: "Fence",
      icon: "shield",
      order: 30,
      // The fence stamp (decision, reason, timelines) beside the pair carries it.
      inTopology: (t) => t.fence !== null,
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
      // SERVE · timelines 1/1 · peer is a standby · peer standby
      summaryParts: (ctx) => {
        const decision = str(ctx, "fence.decision");
        const timeline = text(ctx, "fence.timeline");
        const reason = str(ctx, "fence.reason");
        const peerRole = str(ctx, "fence.peerRole");
        return runs(
          [decision !== null && part(decision.toUpperCase(), lvl(ctx, "fence.decision"), true)],
          [
            timeline !== null &&
              part(
                `timelines ${timeline}/${text(ctx, "fence.peerTimeline") ?? "-"}`,
                quiet(lvl(ctx, "fence.peerTimeline")),
              ),
          ],
          [reason !== null && part(reason, "info")],
          [peerRole !== null && part(`peer ${peerRole}`, "info")],
        );
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
      // 5e7d0a42 26 min ago · 73.7 MiB in 18 s · ok · next in 23 h 32 min
      summaryParts: (ctx) => {
        const snapshot = str(ctx, "backup.snapshot");
        const result = str(ctx, "backup.lastResult");
        const last = ageOf(ctx, "backup.lastAt");
        const next = ageOf(ctx, "backup.nextAt");
        const size = num(ctx, "backup.size");
        const took = num(ctx, "backup.durationS");
        const failed = str(ctx, "backup.failedStep");
        const amount =
          [
            size !== null ? formatBytes(size) : str(ctx, "backup.size"),
            took !== null && `in ${formatDuration(took)}`,
          ]
            .filter(Boolean)
            .join(" ") || null;
        return runs(
          [
            snapshot !== null && part(snapshot, lvl(ctx, "backup.lastResult")),
            last !== null && part(formatRelative(Math.max(0, last)), quiet(lvl(ctx, "backup.lastAt"))),
          ],
          [amount !== null && part(amount, "info")],
          [
            result !== null &&
              part(result === "none" ? "no backup yet" : result, quiet(lvl(ctx, "backup.lastResult"))),
          ],
          [failed !== null && part(`failed at ${failed}`, "crit")],
          [
            next !== null && part("next", "info"),
            next !== null &&
              part(next >= 0 ? "due now" : formatRelative(next), quiet(lvl(ctx, "backup.nextAt"))),
          ],
        );
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
      // 2 of 2 online · offline none · runner-1 (idle), watch-1 (idle)
      summaryParts: (ctx) => {
        const online = num(ctx, "runners.online");
        const total = num(ctx, "runners.total");
        const offline = str(ctx, "runners.offline");
        const list = str(ctx, "runners.list");
        return runs(
          [online !== null && part(total !== null ? `${online} of ${total} online` : `${online} online`)],
          [offline !== null && part(`offline ${offline}`, quiet(lvl(ctx, "runners.offline")))],
          [list !== null && part(runnerList(list), "info")],
        );
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
      // 12G / 79G (16%), coloured by the percentage's level
      summaryParts: (ctx) => {
        const used = num(ctx, "disk.usedBytes");
        const size = num(ctx, "disk.sizeBytes");
        const percent = num(ctx, "disk.percent");
        const level = lvl(ctx, "disk.percent");
        const display = str(ctx, "disk.display");
        if (display !== null) return [part(display, level)];
        return runs(
          [used !== null && size !== null && part(`${formatBytes(used)} / ${formatBytes(size)}`, level)],
          [percent !== null && part(`${percent}%`, level)],
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
      // reachable (HTTP 200)
      summaryParts: (ctx) => {
        const status = watchdogText(ctx);
        return status === null ? null : [part(status, lvl(ctx, "watchdog.reachable"))];
      },
    },
  ],
  // After the snapshot, the last summary figure.
  highlights: [{ fact: "watchdog.reachable", label: "watchdog", slot: 90 }],
  headline: (ctx) => {
    const serving = str(ctx, "forgejo.servingNode");
    if (serving === null) return null;
    const paired = ctx.config.topology?.edges.some((e) => e.kind === "replication");
    const replication = !paired
      ? null
      : streaming(ctx)
        ? `replication ${str(ctx, "replication.state")}`
        : replicationLine(ctx, replicationDetail(ctx));
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
  const lagCurrent = current(ctx, fact("replication.lagSeconds"));
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
        : !live
          ? // Without a replication fact nothing says the stream stopped.
            replicationKnown(ctx)
            ? { label: "wal", value: "stopped", state: "down" }
            : { label: "wal", value: "no data", state: "unknown" }
          : lag === null
            ? { label: "wal", value: "live", state: "up" }
            : // A lag past its window shows its last value and age, stale: "lag 0 s, 20 min ago".
              {
                label: "wal",
                value: lastKnown(ctx, "replication.lagSeconds", `lag ${lag}`),
                state: lagCurrent ? "up" : "stale",
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
  const timeline = text(ctx, "fence.timeline");
  return {
    nodes,
    edges: topology.edges.map((e) =>
      e.kind === "replication" ? { ...e, live, detail: replicationDetail(ctx) } : e,
    ),
    fence:
      decision === null
        ? topology.fence
        : {
            decision,
            reason: str(ctx, "fence.reason"),
            level: decision === "serve" ? "ok" : "crit",
            detail: timeline === null ? null : `tl ${timeline}/${text(ctx, "fence.peerTimeline") ?? "-"}`,
          },
  };
}
