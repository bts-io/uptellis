import type { ReactNode } from "react";
import { Age, EmptyState, FactList, Gauge, Icon, isIconName, Panel, TopologyTile } from "@/client/kit";
import type { TopologyTileProps } from "@/client/kit/props";
import { type DisplayState, type FactGroupView, highlightedGroups, type SiteView } from "@/shared/view";
import { cx, hhmm, LEVEL_TEXT, probeStale } from "./format";

/** Topology tile (failover pair, replication edge, fence stamp) over one row per fact group. */
export function InfraPanel({ view }: { view: SiteView }) {
  // Groups the summary box already shows through their highlights stay out of infra.
  const inSummary = highlightedGroups(view);
  const groups = view.factGroups.filter((g) => !inSummary.has(g.id));
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
            caption={replication ? "failover pair" : "topology"}
            rows={nodeRows(view, stale)}
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
            <Icon name={isIconName(g.icon) ? g.icon : "grid"} className="mt-[3px] text-muted" />
            <span className="font-semibold text-accent lowercase">{g.title}</span>
            <div className={cx("min-w-0", !g.fresh && "opacity-70")}>
              <GroupValue group={g} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** A percentage value (`16%`) of a node detail, for its gauge. */
const percentOf = (value: string) => {
  const m = /^(\d+(?:\.\d+)?)%$/.exec(value);
  return m ? Number(m[1]) : undefined;
};

/** The cards' rows: each node's `details` from the profiles (e.g. forgejo serving, postgres primary, disk 16%). */
function nodeRows(view: SiteView, stale: boolean): TopologyTileProps["rows"] {
  const rows: NonNullable<TopologyTileProps["rows"]> = {};
  const shown = (state: DisplayState): DisplayState => (stale ? "stale" : state);
  for (const n of view.topology?.nodes ?? []) {
    if (!n.details.length) continue;
    rows[n.id] = n.details.map((d) => {
      const percent = percentOf(d.value);
      return {
        label: d.label,
        value: d.value,
        // A percentage draws a gauge in its state's colour instead of a dot.
        state: d.state === null || percent !== undefined ? undefined : shown(d.state),
        percent,
        level:
          d.state === "down"
            ? "crit"
            : d.state === "degraded"
              ? "warn"
              : percent !== undefined
                ? "ok"
                : undefined,
      };
    });
  }
  return Object.keys(rows).length ? rows : undefined;
}

/** `peer is a standby · 23:45`: the fence's reason and when the facts probe last reported. */
function fenceDetail(view: SiteView): string | undefined {
  const fence = view.topology?.fence;
  if (!fence) return undefined;
  const probe = view.freshness.perSource.find((s) => s.kind === "facts");
  return [fence.reason, probe?.lastSeenAt && hhmm(probe.lastSeenAt)].filter(Boolean).join(" · ");
}

/** A group's one-line summary (with a gauge when a row is a percentage), else its rows. */
function GroupValue({ group }: { group: FactGroupView }) {
  if (!group.summary) return <FactList rows={group.rows} />;
  const gauge = group.rows.find((r) => r.percent !== null);
  const tone = group.level === "warn" || group.level === "crit" ? LEVEL_TEXT[group.level] : undefined;
  return (
    <Inline>
      {gauge?.percent != null && (
        <Gauge value={gauge.percent} cells={18} level={gauge.level ?? undefined} label={gauge.label} />
      )}
      <span className={tone}>{group.summary}</span>
    </Inline>
  );
}

function Inline({ children }: { children: ReactNode }) {
  return <span className="inline-flex flex-wrap items-center gap-1.5">{children}</span>;
}
