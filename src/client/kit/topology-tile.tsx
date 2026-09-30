import { type EdgeState, edgeState, type TopologyView } from "@/shared/view";
import { cx } from "./cx";
import { Gauge } from "./gauge";
import type { TopologyTileProps } from "./props";
import { StateDot } from "./state-dot";
import { LEVEL_TONE, TEXT } from "./tone";

type Node = TopologyView["nodes"][number];
type Edge = TopologyView["edges"][number];
type Row = NonNullable<TopologyTileProps["rows"]>[string][number];

const ROLE_MARK: Record<string, string> = { primary: "◆", standby: "◇" };

function NodeRow({ row }: { row: Row }) {
  return (
    <div className="flex items-center justify-between gap-1.5 leading-[1.75] text-muted">
      {row.label}
      <b
        className={cx(
          "inline-flex min-w-0 items-center gap-[5px] font-medium",
          row.level ? TEXT[LEVEL_TONE[row.level]] : "text-ink",
        )}
      >
        {row.state && <StateDot state={row.state} />}
        {row.percent !== undefined && (
          <Gauge value={row.percent} cells={8} level={row.level} label={`${row.label} used`} />
        )}
        <span className="truncate">{row.value}</span>
      </b>
    </div>
  );
}

function NodeCard({ node, rows }: { node: Node; rows: Row[] | undefined }) {
  const serving = node.note === "serving";
  const role = node.roles[0] ?? "other";
  return (
    <div
      data-node={node.id}
      className={cx(
        "min-w-0 px-[11px] py-2.5 text-[11.5px]",
        serving
          ? "border-gradient-brand shadow-[0_8px_24px_-12px_var(--color-up)]"
          : "border border-hair bg-raised",
      )}
    >
      {/* The name never truncates; the location drops to its own line when both do not fit. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-1.5">
        <span className="text-[13px] font-bold break-all text-ink">{node.label}</span>
        {node.location && <span className="min-w-0 truncate text-[10.5px] text-faint">{node.location}</span>}
      </div>
      <div
        className={cx(
          "mt-0.5 mb-[7px] text-[10.5px] font-bold uppercase tracking-[0.1em]",
          serving ? "text-gradient-brand" : "text-muted",
        )}
      >
        {ROLE_MARK[role] ? `${ROLE_MARK[role]} ` : ""}
        {node.roles.join(" + ")}
      </div>
      {(rows ?? [{ label: "state", value: node.note ?? node.state, state: node.state }]).map((r) => (
        <NodeRow key={r.label} row={r} />
      ))}
    </div>
  );
}

const EDGE_TONE: Record<EdgeState, string> = { live: "text-up", stopped: "text-down", unknown: "text-muted" };
const EDGE_WORD: Record<EdgeState, string> = { live: "streaming", stopped: "stopped", unknown: "no data" };

/**
 * The replication link between the pair: a flowing dashed line while live, a broken one with a cross when
 * stopped, a still muted dotted one reading "no data" when nothing reports on it (`edgeState`). Its labels
 * wrap inside the edge column, so a long detail grows the row instead of running into a node.
 */
function EdgeLink({ edge, state }: { edge: Edge; state: EdgeState }) {
  return (
    <div
      data-edge={`${edge.from}-${edge.to}`}
      data-live={edge.live}
      data-state={state}
      className={cx(
        "relative flex h-[74px] min-w-0 flex-row items-center justify-center gap-3 md:h-auto md:min-h-14 md:flex-col md:gap-[5px] md:px-1 md:py-1.5",
        EDGE_TONE[state],
      )}
    >
      <div
        aria-hidden="true"
        className={cx(
          "relative h-full w-0.5 md:h-0.5 md:w-full",
          state === "live"
            ? "bg-[repeating-linear-gradient(180deg,currentColor_0_6px,transparent_6px_11px)] bg-size-[2px_11px] motion-safe:animate-kit-flow-y md:bg-[repeating-linear-gradient(90deg,currentColor_0_6px,transparent_6px_11px)] md:bg-size-[11px_2px] md:motion-safe:animate-kit-flow-x"
            : state === "stopped"
              ? "bg-[linear-gradient(180deg,currentColor_0_34%,transparent_34%_66%,currentColor_66%_100%)] md:bg-[linear-gradient(90deg,currentColor_0_38%,transparent_38%_62%,currentColor_62%_100%)]"
              : "bg-[repeating-linear-gradient(180deg,currentColor_0_3px,transparent_3px_8px)] opacity-60 md:bg-[repeating-linear-gradient(90deg,currentColor_0_3px,transparent_3px_8px)]",
        )}
      >
        <span className="absolute -bottom-[3px] -left-1 border-x-[5px] border-t-[7px] border-x-transparent border-t-current md:top-[-4px] md:-right-0.5 md:bottom-auto md:left-auto md:border-y-[5px] md:border-r-0 md:border-l-[7px] md:border-y-transparent md:border-l-current" />
        {state === "stopped" && (
          <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[54%] text-[15px] font-bold">
            ×
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 md:items-center md:text-center">
        <span className="text-[10.5px] tracking-[0.02em]">
          {state === "unknown" ? EDGE_WORD.unknown : (edge.label ?? EDGE_WORD[state])}
        </span>
        {edge.detail && <span className="text-[10px] leading-tight text-faint">{edge.detail}</span>}
      </div>
    </div>
  );
}

const byId = (nodes: Node[], id: string) => nodes.find((n) => n.id === id);

/**
 * Topology on a dot grid: the first replication pair drawn as node, flowing edge, node (stacked on mobile)
 * with optional per-node rows, the fence decision as a double-ruled stamp naming the serving node, then the
 * remaining nodes as compact lines (with the edges they start) and any other edges. The edge animates only
 * while `live` and never under reduced motion; one nothing reports on reads "no data" in the muted colour.
 */
export function TopologyTile({ topology, rows, caption, fenceDetail }: TopologyTileProps) {
  const { nodes, edges, fence } = topology;
  const pairEdge = edges.find((e) => e.kind === "replication" && byId(nodes, e.from) && byId(nodes, e.to));
  const pair = pairEdge ? [byId(nodes, pairEdge.from)!, byId(nodes, pairEdge.to)!] : [];
  const rest = nodes.filter((n) => !pair.includes(n));
  const otherEdges = edges.filter((e) => e !== pairEdge);
  const looseEdges = otherEdges.filter((e) => !rest.some((n) => n.id === e.from));
  const serving = nodes.find((n) => n.note === "serving");
  const detail = fenceDetail ?? fence?.reason;
  return (
    <figure
      aria-label="Topology"
      className="relative m-0 border border-hair bg-[color-mix(in_oklab,var(--color-base)_50%,var(--color-panel))] bg-[radial-gradient(color-mix(in_oklab,var(--color-ink)_8.5%,transparent)_1px,transparent_1.3px)] bg-size-[14px_14px] px-3.5 pt-[18px] pb-3.5 font-mono"
    >
      {caption && (
        <figcaption className="absolute top-2 left-3 text-[10.5px] tracking-[0.08em] text-faint uppercase">
          {caption}
        </figcaption>
      )}
      {pairEdge && (
        <div
          className={cx(
            "grid grid-cols-1 items-center md:grid-cols-[minmax(0,1fr)_78px_minmax(0,1fr)]",
            caption && "mt-3.5",
          )}
        >
          <NodeCard node={pair[0]!} rows={rows?.[pair[0]!.id]} />
          <EdgeLink edge={pairEdge} state={edgeState(pairEdge, nodes)} />
          <NodeCard node={pair[1]!} rows={rows?.[pair[1]!.id]} />
        </div>
      )}
      {fence && (
        <div className="mt-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11.5px]">
          <span
            className={cx(
              "border border-current px-2 py-px text-[11px] font-extrabold uppercase tracking-[0.12em] outline-1 outline-offset-2 outline-current",
              TEXT[LEVEL_TONE[fence.level]],
            )}
          >
            {fence.decision}
          </span>
          {serving && (
            <span className="text-ink">
              primary=<b>{serving.label}</b>
            </span>
          )}
          {detail && <span className="basis-full text-muted">{detail}</span>}
        </div>
      )}
      {rest.length > 0 && (
        <ul
          className={cx(
            "m-0 list-none space-y-0.5 p-0 text-[11px] text-muted",
            (pairEdge || fence) && "mt-3 border-t border-dashed border-hair pt-2.5",
          )}
        >
          {rest.map((n) => (
            <li key={n.id} data-node={n.id} className="flex flex-wrap items-center gap-x-1.5">
              <StateDot state={n.state} label={`${n.label} ${n.state}`} />
              <span className="font-semibold text-ink">{n.label}</span>
              {n.roles.join(" + ")}
              {otherEdges
                .filter((e) => e.from === n.id)
                .map((e) => (
                  <span key={`${e.kind}-${e.to}`} data-edge={`${e.from}-${e.to}`}>
                    · {e.label ?? e.kind} <span className="text-ink">{e.to}</span>
                    {e.detail && <span className="text-faint"> · {e.detail}</span>}
                  </span>
                ))}
            </li>
          ))}
        </ul>
      )}
      {looseEdges.length > 0 && (
        <ul className="m-0 mt-3 list-none space-y-0.5 p-0 text-[11px] text-muted">
          {looseEdges.map((e) => (
            <li key={`${e.from}-${e.kind}-${e.to}`} data-edge={`${e.from}-${e.to}`}>
              <span className="text-ink">{e.from}</span> {e.label ?? e.kind}{" "}
              <span className="text-ink">{e.to}</span>
              {e.detail && <span className="text-faint"> · {e.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
