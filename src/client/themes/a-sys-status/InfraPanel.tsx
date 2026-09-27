import type { ReactNode } from "react";
import { Age, EmptyState, FactList, Gauge, Icon, Panel, StateDot, TopologyTile } from "@/client/kit";
import type { IconName, TopologyTileProps } from "@/client/kit/props";
import type { DisplayState, FactGroupView, SiteView } from "@/shared/view";
import { cx, DASH, fact, factText, hhmm, LEVEL_TEXT, probeStale } from "./format";

/** Groups the summary box already shows. */
const IN_SUMMARY = new Set(["kuma", "watchdog"]);

const GROUP_ICON: Record<string, IconName> = {
  forgejo: "server",
  replication: "database",
  fence: "shield",
  backup: "box",
  runners: "bolt",
  disk: "host",
};

/** Topology tile (failover pair, replication edge, fence stamp) over one row per fact group. */
export function InfraPanel({ view }: { view: SiteView }) {
  const groups = view.factGroups.filter((g) => !IN_SUMMARY.has(g.id));
  const probe = view.freshness.perSource.find((s) => s.kind === "facts");
  // Infra is only as stale as its own probe: a silent Kuma collector does not age fresh facts.
  const stale = probeStale(view);
  const replication = view.topology?.edges.find((e) => e.kind === "replication");
  const failing =
    groups.some((g) => g.level === "crit") ||
    view.topology?.fence?.level === "crit" ||
    (replication !== undefined && !replication.live);

  return (
    <Panel
      id="infra"
      title="infra"
      exitCode={failing ? 1 : 0}
      level={view.topology?.fence?.level === "crit" ? "crit" : undefined}
      aside={
        probe?.lastSeenAt ? (
          <>
            probe <Age since={probe.lastSeenAt} now={view.now} />
          </>
        ) : undefined
      }
      className={cx(stale && "border-dashed")}
    >
      {view.topology && (
        <div className={cx("mt-1.5", stale && "saturate-[.4]")}>
          <TopologyTile
            topology={view.topology}
            caption="forgejo failover pair"
            rows={pairRows(view, stale)}
            fenceDetail={fenceDetail(view)}
          />
        </div>
      )}
      {!view.topology && !groups.length && (
        <EmptyState
          title="No infrastructure facts yet"
          detail="The facts probe has not reported for this site."
        />
      )}
      <div className={cx("mt-3", stale && "saturate-[.4]")}>
        {groups.map((g) => (
          <div
            key={g.id}
            className="grid grid-cols-[16px_12ch_minmax(0,1fr)] items-start gap-x-2.5 border-b border-dashed border-hair py-[7px] last:border-b-0 last:pb-0"
          >
            <Icon name={GROUP_ICON[g.id] ?? "grid"} className="mt-[3px] text-muted" />
            <span className="font-semibold text-accent lowercase">{g.title}</span>
            <div className={cx("min-w-0", !g.fresh && "opacity-70")}>
              {groupValue(view, g, stale || !g.fresh)}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** Postgres as the mock-up names it: a standby is a replica. */
const pgRole = (role: string) => (role === "standby" ? "replica" : role);

/**
 * Rows of the failover pair's cards: forgejo serving or idle, the Postgres role, and the disk (reported by
 * the node running the facts probe, `forgejo.node`). The reporting node vouches for its own Postgres role;
 * the peer's comes from its topology state (down when unreachable, not streaming while degraded).
 */
function pairRows(view: SiteView, stale: boolean): TopologyTileProps["rows"] {
  const topo = view.topology!;
  const pair = topo.edges.find((e) => e.kind === "replication");
  if (!pair) return undefined;
  const reporter = factText(view, "forgejo.node");
  const disk = fact(view, "disk.percent");
  const shown = (state: DisplayState): DisplayState => (stale ? "stale" : state);
  const rows: NonNullable<TopologyTileProps["rows"]> = {};
  for (const n of topo.nodes.filter((x) => x.id === pair.from || x.id === pair.to)) {
    const forgejo =
      n.note === "serving"
        ? { label: "forgejo", value: n.state === "down" ? "down" : "serving", state: shown(n.state) }
        : { label: "forgejo", value: "idle", state: shown("paused") };
    const role = factText(view, "replication.role");
    const postgres =
      n.id === reporter
        ? { label: "postgres", value: pgRole(role), state: shown(role === DASH ? "unknown" : "up") }
        : {
            label: "postgres",
            value:
              n.state === "down"
                ? "down"
                : n.state === "degraded"
                  ? "not streaming"
                  : n.state === "unknown"
                    ? DASH
                    : pgRole(n.note === "serving" ? "primary" : (n.note ?? "standby")),
            state: shown(n.state),
            level:
              n.state === "down" ? ("crit" as const) : n.state === "degraded" ? ("warn" as const) : undefined,
          };
    const diskRow =
      n.id === reporter && disk?.percent != null
        ? {
            label: "disk",
            value: `${disk.percent}%`,
            percent: disk.percent,
            level: disk.level ?? undefined,
          }
        : { label: "disk", value: "n/a" };
    rows[n.id] = [forgejo, postgres, diskRow];
  }
  return rows;
}

/** `tl 1/1 · peer is a standby · 23:58`: the timelines the fence compared, its reason and when it decided. */
function fenceDetail(view: SiteView): string | undefined {
  const decision = fact(view, "fence.decision");
  if (!decision) return undefined;
  const t = (key: string) => factText(view, `fence.${key}`);
  const reason = fact(view, "fence.reason");
  return [`tl ${t("timeline")}/${t("peerTimeline")}`, reason?.display, hhmm(decision.observedAt)]
    .filter(Boolean)
    .join(" · ");
}

function groupValue(view: SiteView, g: FactGroupView, stale: boolean): ReactNode {
  const t = (key: string) => factText(view, `${g.id}.${key}`);
  const lvl = (key: string) => {
    const l = fact(view, `${g.id}.${key}`)?.level;
    return l ? LEVEL_TEXT[l] : undefined;
  };
  const dot = (key: string) => {
    const l = fact(view, `${g.id}.${key}`)?.level;
    return <StateDot state={stale ? "stale" : l === "crit" ? "down" : l === "warn" ? "degraded" : "up"} />;
  };

  switch (g.id) {
    case "forgejo":
      return (
        <>
          <Inline>
            {dot("healthzOk")}
            {t("version")}
          </Inline>{" "}
          <span className="text-muted">
            · <span className={lvl("healthzCode")}>{t("healthzCode")}</span> · serving {t("servingNode")}
          </span>
        </>
      );
    case "replication":
      return (
        <>
          <Inline>
            <span className={cx("font-semibold", lvl("state"))}>{t("state")}</span>
            <span className="text-muted">lag</span>
            <span className={lvl("lagSeconds")}>{t("lagSeconds")}</span>
          </Inline>
          <Sub>
            {t("role")} · peer {t("peer")}{" "}
            {t("peerReachable") !== DASH && `(reachable ${t("peerReachable")})`}
          </Sub>
          <Sub>standby connected {t("standbyConnected")}</Sub>
        </>
      );
    case "fence":
      return (
        <>
          <span className={cx("font-bold uppercase", lvl("decision"))}>{t("decision")}</span>{" "}
          <span className="text-muted">
            · timelines {t("timeline")}/{t("peerTimeline")}
          </span>
          <Sub>
            {t("reason")} · peer {t("peerRole")}
          </Sub>
        </>
      );
    case "backup":
      return (
        <>
          <Inline>
            <span className={lvl("lastResult")}>{t("snapshot")}</span>
            <span className="text-muted">{t("lastAt")}</span>
          </Inline>
          <Sub>
            {t("size")} in {t("durationS")} · {t("lastResult")}
          </Sub>
          <Sub>
            next <span className={lvl("nextAt")}>{t("nextAt")}</span>
          </Sub>
        </>
      );
    case "runners":
      return (
        <>
          <Inline>
            {dot("online")}
            {t("online")} online
            <span className="text-muted">· offline {t("offline")}</span>
          </Inline>
          <Sub>{t("list")}</Sub>
        </>
      );
    case "disk": {
      const percent = fact(view, "disk.percent");
      return (
        <Inline>
          {percent?.percent != null && (
            <Gauge value={percent.percent} cells={18} level={percent.level ?? undefined} label="disk used" />
          )}
          <span className={lvl("percent")}>{t("display")}</span>
        </Inline>
      );
    }
    default:
      return <FactList rows={g.rows} />;
  }
}

function Inline({ children }: { children: ReactNode }) {
  return <span className="inline-flex flex-wrap items-center gap-1.5">{children}</span>;
}

function Sub({ children }: { children: ReactNode }) {
  return <div className="text-xs text-muted">{children}</div>;
}
