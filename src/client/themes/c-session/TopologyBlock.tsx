import { EmptyState, Gauge, StateDot, SummaryParts } from "@/client/kit";
import {
  type DisplayState,
  type EdgeState,
  edgeState,
  type FactGroupView,
  highlightedGroups,
  type SiteView,
  type TopologyView,
} from "@/shared/view";
import { Block, DataAge } from "./Block";
import { cx, DASH, isMeasure, LEVEL_TEXT, levelState, probeStale } from "./format";
import { KeyValues } from "./KeyValues";

type Node = TopologyView["nodes"][number];
type Edge = TopologyView["edges"][number];

/**
 * The failover pair as node, replication edge, node and the fence stamp; backup, runners, disk and watchdog
 * facts under it; then every machine. It ages with the facts probe, not with the Kuma collector.
 */
export function TopologyBlock({ view }: { view: SiteView }) {
  const topo = view.topology;
  const probe = view.freshness.perSource.find((s) => s.kind === "facts");
  const stale = probeStale(view);
  const pairEdge = topo?.edges.find((e) => e.kind === "replication");
  const pair = pairEdge
    ? [pairEdge.from, pairEdge.to]
        .map((id) => topo!.nodes.find((n) => n.id === id))
        .filter((n) => n !== undefined)
    : [];
  const pairState = pairEdge && edgeState(pairEdge, topo!.nodes);
  // Only a replication the data says stopped fails the block; one nothing reports on does not.
  const failing =
    view.factGroups.some((g) => g.level === "crit") ||
    topo?.fence?.level === "crit" ||
    pairState === "stopped";
  const shown = (state: DisplayState): DisplayState => (stale ? "stale" : state);
  const pairDrawn = pairEdge !== undefined && pair.length === 2;
  // The summary block shows the highlighted groups, and the drawn pair the groups it carries (replication
  // on its edge and cards, the fence as its stamp).
  const inSummary = highlightedGroups(view);
  const groups = view.factGroups.filter((g) => !inSummary.has(g.id) && !(pairDrawn && g.inTopology));

  return (
    <Block
      id="infra"
      title="Topology"
      command="infra --topology"
      aside={<DataAge view={view} since={probe?.lastSeenAt ?? null} stale={stale} />}
      exitCode={failing ? 1 : 0}
      stale={stale}
    >
      {!topo && !view.factGroups.length && (
        <EmptyState
          title="No infrastructure facts yet"
          detail="The facts probe has not reported for this site."
        />
      )}
      {pairDrawn && (
        <div className="flex flex-col items-stretch min-[981px]:flex-row min-[981px]:items-center">
          <div className="flex flex-col items-stretch md:flex-row md:items-center">
            <NodeBox node={pair[0]!} stale={stale} />
            <EdgeLine edge={pairEdge} state={pairState!} stale={stale} />
            <NodeBox node={pair[1]!} stale={stale} />
          </div>
          {topo?.fence && <FenceStamp fence={topo.fence} stale={stale} />}
        </div>
      )}
      {topo?.fence && !pairEdge && <FenceStamp fence={topo.fence} stale={stale} />}
      {groups.length > 0 && <InfraFacts groups={groups} stale={stale} />}
      {topo && topo.nodes.length > 0 && (
        <ul className="m-0 mt-4 grid list-none grid-cols-2 overflow-hidden rounded-lg border border-hair p-0 md:grid-cols-4">
          {topo.nodes.map((n) => (
            <li
              key={n.id}
              data-node={n.id}
              className="min-w-0 border-hair px-3.5 py-[9px] max-md:nth-[-n+2]:border-b max-md:odd:border-r md:border-r md:last:border-r-0"
            >
              <div className="flex items-center gap-2 font-mono text-[13px] leading-[1.3] font-medium">
                <StateDot state={shown(n.state)} label={`${n.label} ${shown(n.state)}`} />
                {n.label}
              </div>
              <div className="truncate font-sans text-xs leading-[1.4] text-muted">
                {[n.roles.join(" + "), n.location].filter(Boolean).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

function NodeBox({ node, stale }: { node: Node; stale: boolean }) {
  const serving = node.note === "serving";
  const role = node.roles[0] ?? "node";
  const mark = role === "primary" ? "◆" : role === "standby" ? "◇" : "";
  // The profiles' rows for this node, `forgejo serving · postgres primary · wal lag 0 s`: failures in their
  // colour, a fine measure (`lag 0 s`, `16%`) in green as the original's `HTTP 200`, words in the muted text.
  const detail = node.details.length
    ? node.details.map((d, i) => (
        <span key={d.label}>
          {i > 0 && " · "}
          <span
            className={cx(
              !stale && d.state === "down" && "text-down",
              !stale && d.state === "degraded" && "text-degraded",
            )}
          >
            {d.label}{" "}
            {!stale && d.state === "up" && isMeasure(d.value) ? (
              <span className="text-up">{d.value}</span>
            ) : (
              d.value
            )}
          </span>
        </span>
      ))
    : (node.note ?? DASH);
  return (
    <div
      data-node={node.id}
      className={cx(
        "min-w-0 rounded-lg px-3.5 py-2.5 [--kit-fill:var(--color-raised)]",
        serving && !stale ? "border-gradient-brand" : "border border-hair bg-raised",
      )}
    >
      <div className="flex items-center gap-2 font-mono text-sm leading-[1.3] font-semibold whitespace-nowrap">
        {node.label}
        <span
          className={cx(
            "text-[11px] leading-none font-medium tracking-[0.08em] uppercase",
            serving ? "text-accent" : "text-muted",
          )}
        >
          {mark && `${mark} `}
          {node.roles.join(" + ")}
        </span>
      </div>
      <div className="mt-1 font-sans text-xs leading-normal text-muted md:whitespace-nowrap">
        {node.location && `${node.location} · `}
        {detail}
      </div>
    </div>
  );
}

/**
 * The replication link: a dashed line that flows while live (never stale, never under reduced motion), broken
 * when stopped, a still muted dotted one reading "no data" when nothing reports on it.
 */
function EdgeLine({ edge, state, stale }: { edge: Edge; state: EdgeState; stale: boolean }) {
  const tone = stale
    ? "text-faint"
    : state === "unknown"
      ? "text-muted"
      : state === "live"
        ? "text-up"
        : "text-down";
  const label =
    state === "live"
      ? [edge.label ?? "streaming", edge.detail].filter(Boolean).join(" · ")
      : state === "stopped"
        ? ["stopped", edge.detail].filter(Boolean).join(" · ")
        : "no data";
  return (
    <div
      data-edge={`${edge.from}-${edge.to}`}
      data-live={edge.live}
      data-state={state}
      className={cx(
        "flex min-w-0 items-center justify-center gap-3 py-2.5 md:w-[300px] md:max-w-[300px] md:min-w-[150px] md:flex-col md:gap-1.5 md:px-2.5 md:py-0",
        tone,
      )}
    >
      <span className="font-mono text-[11.5px] leading-none whitespace-nowrap max-md:order-2">{label}</span>
      <span aria-hidden="true" className="relative block h-[52px] w-0.5 md:h-0.5 md:w-full">
        {state === "live" ? (
          <span
            className={cx(
              "absolute inset-0 bg-[repeating-linear-gradient(180deg,currentColor_0_7px,transparent_7px_12px)] bg-size-[2px_12px] md:bg-[repeating-linear-gradient(90deg,currentColor_0_7px,transparent_7px_12px)] md:bg-size-[12px_2px]",
              !stale && "motion-safe:animate-kit-flow-y md:motion-safe:animate-kit-flow-x",
            )}
          />
        ) : state === "stopped" ? (
          <>
            <span className="absolute inset-x-0 top-0 h-[40%] bg-current md:inset-y-0 md:right-auto md:left-0 md:h-full md:w-[41%]" />
            <span className="absolute inset-x-0 bottom-0 h-[40%] bg-[repeating-linear-gradient(180deg,currentColor_0_3px,transparent_3px_8px)] opacity-50 md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[41%] md:bg-[repeating-linear-gradient(90deg,currentColor_0_3px,transparent_3px_8px)]" />
            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[55%] font-mono text-base leading-none font-bold">
              ×
            </span>
          </>
        ) : (
          <span className="absolute inset-0 bg-[repeating-linear-gradient(180deg,currentColor_0_3px,transparent_3px_8px)] opacity-60 md:bg-[repeating-linear-gradient(90deg,currentColor_0_3px,transparent_3px_8px)]" />
        )}
        <span className="absolute -bottom-1 -left-[4px] border-x-[5px] border-t-[8px] border-x-transparent border-t-current md:top-[-4px] md:-right-1 md:bottom-auto md:left-auto md:border-y-[5px] md:border-r-0 md:border-l-[8px] md:border-y-transparent md:border-l-current" />
      </span>
    </div>
  );
}

function FenceStamp({ fence, stale }: { fence: NonNullable<TopologyView["fence"]>; stale: boolean }) {
  // `peer is a standby · tl 1/1`: the reason, then the profile's stamp detail (the timelines compared).
  const detail = [fence.reason, fence.detail].filter(Boolean).join(" · ");
  const tone = stale
    ? "border-muted/45 text-muted"
    : fence.level === "crit"
      ? "border-down/60 bg-down/6 text-down"
      : fence.level === "warn"
        ? "border-degraded/60 bg-degraded/6 text-degraded"
        : "border-up/55 bg-up/5 text-up";
  return (
    <div
      data-fence={fence.decision}
      className={cx(
        "mt-3.5 inline-flex -rotate-[1.5deg] flex-col gap-[3px] self-start rounded-md border-[1.5px] px-3 py-2 font-mono text-xs leading-[1.1] font-semibold tracking-[0.12em] uppercase min-[981px]:mt-0 min-[981px]:ml-7 min-[981px]:self-center",
        tone,
      )}
    >
      fence · {fence.decision}
      <span className="text-[11px] leading-[1.2] font-normal tracking-[0.02em] text-muted normal-case">
        {detail}
      </span>
    </div>
  );
}

/**
 * One line per fact group: a gauge when a row is a percentage, then the profile's summary in coloured parts
 * (else its rows); a first part without a colour of its own (`16.0.5`, `2 of 2 online`) takes the group's dot.
 */
function InfraFacts({ groups, stale }: { groups: FactGroupView[]; stale: boolean }) {
  return (
    <KeyValues
      className="mt-5 border-t border-dashed border-hair pt-4"
      items={groups.map((g) => {
        const gauge = g.rows.find((r) => r.percent !== null);
        const tone = !stale && (g.level === "warn" || g.level === "crit") ? LEVEL_TEXT[g.level] : undefined;
        const [lead] = g.summaryParts;
        return {
          label: g.title.toLowerCase(),
          value: (
            <span className="[&>*]:mr-2 md:inline-flex md:items-center md:gap-2 md:[&>*]:mr-0">
              {gauge?.percent != null ? (
                <Gauge
                  value={gauge.percent}
                  cells={18}
                  level={stale ? "info" : (gauge.level ?? undefined)}
                  label={gauge.label}
                />
              ) : (
                lead?.level === null && <StateDot state={stale ? "stale" : levelState(g.level)} />
              )}
              {g.summaryParts.length ? (
                <SummaryParts parts={g.summaryParts} stale={stale} className={tone} />
              ) : (
                <span className={tone}>{g.rows.map((r) => `${r.label} ${r.display}`).join(" · ")}</span>
              )}
            </span>
          ),
        };
      })}
    />
  );
}
