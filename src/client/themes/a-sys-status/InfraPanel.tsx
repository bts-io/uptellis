import type { ReactNode } from "react";
import {
  Age,
  EmptyState,
  FactList,
  Gauge,
  Icon,
  isIconName,
  Panel,
  StateDot,
  SummaryParts,
  TopologyTile,
} from "@/client/kit";
import type { TopologyTileProps } from "@/client/kit/props";
import {
  type DisplayState,
  edgeState,
  type FactGroupView,
  highlightedGroups,
  type SiteView,
  type SummaryPartView,
  summaryRuns,
} from "@/shared/view";
import { cx, hhmm, isMeasure, LEVEL_STATE, pairCaption, probeStale } from "./format";

/** Topology tile (failover pair, replication edge, fence stamp) over one row per fact group. */
export function InfraPanel({ view }: { view: SiteView }) {
  // Groups the summary box already shows through their highlights stay out of infra.
  const inSummary = highlightedGroups(view);
  const groups = view.factGroups.filter((g) => !inSummary.has(g.id));
  const probe = view.freshness.perSource.find((s) => s.kind === "facts");
  // Infra is only as stale as its own probe: a silent Kuma collector does not age fresh facts.
  const stale = probeStale(view);
  const replication = view.topology?.edges.find((e) => e.kind === "replication");
  // Only a replication the data says stopped fails the panel; one nothing reports on does not.
  const failing =
    groups.some((g) => g.level === "crit") ||
    view.topology?.fence?.level === "crit" ||
    (replication !== undefined && edgeState(replication, view.topology!.nodes) === "stopped");

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
            caption={pairCaption(view.topology)}
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
              <GroupValue group={g} stale={stale || !g.fresh} />
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
        // A measure that is fine (`lag 0 s` on the standby, a gauge) reads green; words stay ink.
        level:
          d.state === "down"
            ? "crit"
            : d.state === "degraded"
              ? "warn"
              : percent !== undefined || (d.state === "up" && isMeasure(d.value))
                ? "ok"
                : undefined,
      };
    });
  }
  return Object.keys(rows).length ? rows : undefined;
}

/**
 * `tl 1/1 · peer is a standby · 23:45`: the profile's stamp detail, the fence's reason and when the facts
 * probe last reported.
 */
function fenceDetail(view: SiteView): string | undefined {
  const fence = view.topology?.fence;
  if (!fence) return undefined;
  const probe = view.freshness.perSource.find((s) => s.kind === "facts");
  return [fence.detail, fence.reason, probe?.lastSeenAt && hhmm(probe.lastSeenAt)]
    .filter(Boolean)
    .join(" · ");
}

/** Characters the first line of an infra row holds before the rest of its summary wraps onto a second. */
const FIRST_LINE = 36;

/**
 * A summary's runs as two lines: the first runs up to `FIRST_LINE` characters (at least one), then the rest,
 * so `streaming lag 0 s · primary` stays up top and `peer app-2 (reachable yes) · standby connected yes`
 * wraps below it, in small muted type as the original rows did. Separators come back between runs.
 */
function splitLines(parts: SummaryPartView[]): [SummaryPartView[], SummaryPartView[]] {
  const runs = summaryRuns(parts);
  const sep: SummaryPartView = { text: "·", level: "info", emphasis: false };
  const join = (list: SummaryPartView[][]) => list.flatMap((r, i) => (i ? [sep, ...r] : r));
  const width = (r: SummaryPartView[]) => r.reduce((n, p) => n + p.text.length + 1, -1);
  let used = width(runs[0] ?? []);
  let n = 1;
  while (n < runs.length && used + 3 + width(runs[n]!) <= FIRST_LINE) used += 3 + width(runs[n++]!);
  return [join(runs.slice(0, n)), join(runs.slice(n))];
}

/**
 * A group's summary in coloured parts, else its rows. A percentage row draws a gauge first; otherwise a
 * line whose first part has no colour of its own (`16.0.5`, `2 of 2 online`) starts with the group's dot.
 * A long summary keeps its first runs on the line and wraps the rest onto a second, smaller one.
 */
function GroupValue({ group, stale }: { group: FactGroupView; stale: boolean }) {
  const [lead] = group.summaryParts;
  if (!lead) return <FactList rows={group.rows} />;
  const [first, rest] = splitLines(group.summaryParts);
  const gauge = group.rows.find((r) => r.percent !== null);
  const second = rest.length > 0 && (
    <SummaryParts parts={rest} className="block text-xs text-muted [overflow-wrap:anywhere]" />
  );
  if (gauge?.percent != null)
    return (
      <>
        <Inline>
          <Gauge value={gauge.percent} cells={18} level={gauge.level ?? undefined} label={gauge.label} />
          <SummaryParts parts={first} className="[overflow-wrap:anywhere]" />
        </Inline>
        {second}
      </>
    );
  // In the text flow, so a long first line wraps under its dot instead of dropping below it.
  return (
    <>
      <span className="block [overflow-wrap:anywhere]">
        {lead.level === null && (
          <span className="mr-1.5 inline-flex align-middle">
            <StateDot state={stale ? "stale" : LEVEL_STATE[group.level]} />
          </span>
        )}
        <SummaryParts parts={first} />
      </span>
      {second}
    </>
  );
}

function Inline({ children }: { children: ReactNode }) {
  return <span className="inline-flex flex-wrap items-center gap-1.5">{children}</span>;
}
