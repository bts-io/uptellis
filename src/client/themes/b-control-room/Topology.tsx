import type { ReactNode } from "react";
import { EmptyState, Icon, StateDot } from "@/client/kit";
import {
  type DisplayState,
  type EdgeState,
  edgeState,
  type ServiceView,
  type SiteView,
  type TopologyView,
} from "@/shared/view";
import {
  allServices,
  cx,
  DASH,
  drawsPair,
  hhmm,
  isMeasure,
  LEVEL_TEXT,
  pairCaption,
  probeStale,
  targetHost,
} from "./format";
import { Chip, Micro, Tile, TileHead } from "./ui";

type Node = TopologyView["nodes"][number];
type Edge = TopologyView["edges"][number];

/**
 * The failover pair on a dot grid: the public endpoint and the watchdog above, the two nodes joined by the
 * replication link (flowing only while live, broken when stopped, muted when nothing reports on it), the fence
 * stamp, a legend and a row of facts.
 * Everything here ages with the facts probe; the per-node service rows age with their Kuma monitors.
 */
export function Topology({ view }: { view: SiteView }) {
  const topo = view.topology;
  const stale = probeStale(view);
  const edge = topo?.edges.find((e) => e.kind === "replication");
  const state = edge && topo ? edgeState(edge, topo.nodes) : undefined;

  return (
    <Tile id="infra" aria-label="Topology" stale={stale} className="flex flex-1 flex-col">
      <TileHead>
        <div className="flex min-w-0 items-center gap-2.5">
          <Micro>Topology</Micro>
          <span className="hidden text-faint sm:inline">/</span>
          <span className="hidden truncate text-[13px] text-muted sm:inline">{pairCaption(topo)}</span>
        </div>
        {state === "live" && <Chip level="ok">streaming</Chip>}
        {state === "stopped" && <Chip level="crit">replication stopped</Chip>}
        {state === "unknown" && <Chip>no data</Chip>}
      </TileHead>

      <div className="m-3 flex flex-1 flex-col justify-center rounded-[10px] border border-(--b-hair2) bg-(--b-canvas) bg-[radial-gradient(var(--b-dotgrid)_1px,transparent_1.2px)] bg-size-[16px_16px] bg-position-[8px_8px] p-[18px] pb-4 max-md:p-3.5">
        {topo && edge && drawsPair(topo) ? (
          <Pair view={view} topo={topo} edge={edge} state={state!} stale={stale} />
        ) : (
          <EmptyState
            title="No infrastructure facts yet"
            detail="The facts probe has not reported a replication pair for this site."
          />
        )}
      </div>

      <FactsRow topo={topo} edge={edge} state={state} />
    </Tile>
  );
}

function Pair({
  view,
  topo,
  edge,
  state,
  stale,
}: {
  view: SiteView;
  topo: TopologyView;
  edge: Edge;
  state: EdgeState;
  stale: boolean;
}) {
  const byId = (id: string) => topo.nodes.find((n) => n.id === id);
  const primary = byId(edge.from);
  const standby = byId(edge.to);
  if (!primary || !standby) return null;
  const watchdog = topo.nodes.find((n) => n.roles.includes("watchdog"));
  const endpoint = allServices(view).find((s) => s.kind === "http" || s.kind === "keyword");
  const lastCheck = endpoint?.recent[0]?.message ?? DASH;
  const fence = topo.fence;
  const probe = view.freshness.perSource.find((s) => s.kind === "facts");

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_104px_minmax(0,1fr)]">
        {endpoint ? (
          <div className="flex min-w-0 items-center gap-2.5 rounded-[10px] border border-hair bg-(--b-node) px-3 py-[9px]">
            <Icon name="link" size={16} className="flex-none text-accent" />
            <div className="min-w-0 font-mono">
              <div className="truncate text-[12.5px]">{targetHost(endpoint)}</div>
              <div className="truncate text-[10.5px] text-muted">{lastCheck}</div>
            </div>
          </div>
        ) : (
          <div />
        )}
        <div />
        {watchdog && (
          <div className="hidden min-w-0 items-center gap-2.5 rounded-[10px] border border-dashed border-(--b-hair3) bg-(--b-canvas) px-3 py-[9px] text-muted md:flex">
            <Icon name="eye" size={16} className="flex-none" />
            <div className="min-w-0 font-mono">
              <div className="truncate text-[11.5px]">watchdog {watchdog.label}</div>
              <div className="truncate text-[10.5px]">{watchdog.details[0]?.value ?? DASH}</div>
            </div>
          </div>
        )}
      </div>

      <div
        aria-hidden="true"
        className="grid h-10 grid-cols-1 md:grid-cols-[minmax(0,1fr)_104px_minmax(0,1fr)]"
      >
        <div className="flex justify-center">
          <span className="relative h-full w-0.5 bg-[linear-gradient(180deg,transparent,var(--color-accent))]">
            <span className="absolute -bottom-px -left-1 border-x-[5px] border-t-[7px] border-x-transparent border-t-accent" />
          </span>
        </div>
        <div />
        <div className="hidden justify-center md:flex">
          <span className="h-full w-0 border-l-[1.5px] border-dashed border-(--b-hair3)" />
        </div>
      </div>

      <div className="grid grid-cols-1 items-stretch md:grid-cols-[minmax(0,1fr)_104px_minmax(0,1fr)] md:items-center">
        <NodeCard view={view} node={primary} stale={stale} />
        <Link edge={edge} state={state} stale={stale} />
        <NodeCard view={view} node={standby} stale={stale} />
      </div>

      {fence && (
        <div className="mt-5 flex justify-center">
          <div
            className={cx(
              "inline-flex max-w-full -rotate-[1.2deg] items-center gap-2 truncate rounded-lg border-[1.5px] border-current/55 bg-current/5 px-2.5 py-[7px] font-mono text-[10.5px] tracking-[.04em] uppercase sm:gap-2.5 sm:px-3 sm:text-[11.5px] sm:tracking-[.06em] shadow-[inset_0_0_0_3px_var(--color-base),inset_0_0_0_4px_color-mix(in_oklab,currentColor_25%,transparent)]",
              fence.level === "crit" ? "text-down" : fence.level === "warn" ? "text-degraded" : "text-up",
            )}
          >
            <span>Fence</span>
            <b className="font-bold tracking-[.12em]">{fence.decision}</b>
            <span className="truncate opacity-75">
              {[fence.reason, probe?.lastSeenAt && hhmm(probe.lastSeenAt)].filter(Boolean).join(" · ")}
            </span>
          </div>
        </div>
      )}

      <div
        data-legend
        className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 font-mono text-[10.5px] text-muted"
      >
        <LegendItem>
          <span className="h-0.5 w-[18px] bg-[repeating-linear-gradient(90deg,var(--color-up)_0_4px,transparent_4px_7px)]" />
          streaming
        </LegendItem>
        <LegendItem>
          <span className="h-0.5 w-[18px] bg-[repeating-linear-gradient(90deg,var(--color-degraded)_0_4px,transparent_4px_7px)]" />
          lag warning
        </LegendItem>
        <LegendItem>
          <span className="font-bold text-down">-×-</span>
          stopped
        </LegendItem>
        <LegendItem>
          <span className="h-0.5 w-[18px] bg-[repeating-linear-gradient(90deg,var(--color-muted)_0_2px,transparent_2px_5px)]" />
          no data
        </LegendItem>
        <LegendItem>
          <span className="size-3 rounded-[3px] border-gradient-brand [--kit-fill:var(--b-node)]" />
          serving node
        </LegendItem>
      </div>
    </>
  );
}

function LegendItem({ children }: { children: ReactNode }) {
  return <span className="flex items-center gap-1.5">{children}</span>;
}

/** A port monitor aimed at this node (`app-2:22`). */
const portCheck = (view: SiteView, node: Node, port: number): ServiceView | undefined =>
  allServices(view).find((s) => s.kind === "port" && s.targetDisplay === `${node.label}:${port}`);

/** A percentage value (`16%`) of a node detail, for its bar. */
const percentOf = (value: string) => {
  const m = /^(\d+(?:\.\d+)?)%$/.exec(value);
  return m ? Number(m[1]) : null;
};

const BAR: Partial<Record<DisplayState, string>> = { down: "bg-down", degraded: "bg-degraded" };

/**
 * One node of the pair: the rows its profiles give it (e.g. forgejo serving, postgres primary), ssh from the
 * node's own port monitor, then percentages (e.g. the disk) with a bar.
 */
function NodeCard({ view, node, stale }: { view: SiteView; node: Node; stale: boolean }) {
  const serving = node.note === "serving";
  const primary = node.roles.includes("primary");
  const down = node.state === "down";
  const shown = (state: DisplayState): DisplayState => (stale ? "stale" : state);
  const ssh = portCheck(view, node, 22);
  const rows = node.details.filter((d) => percentOf(d.value) === null);
  const gauges = node.details.filter((d) => percentOf(d.value) !== null);

  return (
    <div
      data-node={node.id}
      className={cx(
        "flex min-w-0 flex-col gap-[9px] rounded-xl px-3 py-3 font-mono shadow-[0_10px_30px_-12px_var(--b-shadow)]",
        serving && !down
          ? cx(
              "border-gradient-brand [--kit-fill:var(--b-node)]",
              !stale && "shadow-[0_12px_40px_-14px_var(--b-serving-glow)]",
            )
          : cx("border bg-(--b-node)", down ? "border-down/50" : "border-hair"),
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">{node.label}</span>
        <Chip level={primary ? "ok" : "info"} className="px-1.5">
          {primary ? "◆ pri" : "◇ stby"}
        </Chip>
      </div>
      <div className="-mt-1 truncate text-[11px] text-muted">{node.location ?? DASH}</div>
      {rows.map((d) => (
        <Row key={d.label} label={d.label}>
          {d.state && <StateDot state={d.state === "paused" ? "paused" : shown(d.state)} />}
          <span className={rowTone(d, stale)}>{d.value}</span>
        </Row>
      ))}
      {ssh && (
        <Row label="ssh">
          <StateDot state={ssh.state} />
          {ssh.latencyMs === null ? (
            ssh.state === "down" ? (
              <span className="text-down">timeout</span>
            ) : (
              <span className="text-muted">{DASH}</span>
            )
          ) : (
            `${ssh.latencyMs} ms`
          )}
        </Row>
      )}
      {gauges.map((d) => (
        <div key={d.label} className="flex flex-col gap-[9px]">
          <Row label={d.label}>{d.value}</Row>
          <Bar percent={percentOf(d.value)!} className={(d.state && BAR[d.state]) ?? "bg-up"} />
        </div>
      ))}
    </div>
  );
}

/**
 * A card row's colour: failures in red or amber; a fine measure (`lag 0 s` on the standby) in green, as the
 * original's `0 s behind`; words (`serving`, `replica`) stay ink. Stale facts keep only the failure colours.
 */
function rowTone(d: Node["details"][number], stale: boolean): string | undefined {
  if (d.state === "down") return "text-down";
  if (d.state === "degraded") return "text-degraded";
  return !stale && d.state === "up" && isMeasure(d.value) ? "text-up" : undefined;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11.5px] whitespace-nowrap text-muted">
      <span>{label}</span>
      <b className="inline-flex min-w-0 items-center gap-1.5 font-medium text-ink">{children}</b>
    </div>
  );
}

function Bar({ percent, className }: { percent: number; className: string }) {
  return (
    <div className="h-1 overflow-hidden rounded-[3px] bg-hair">
      <span className={cx("block h-full rounded-[3px]", className)} style={{ width: `${percent}%` }} />
    </div>
  );
}

const LINK_TONE: Record<EdgeState, string> = { live: "text-up", stopped: "text-down", unknown: "text-muted" };

/**
 * The replication link: a dashed line flowing toward the standby while live (still under reduced motion or
 * stale facts), broken with a cross when stopped, a still muted dotted line reading "no data" when nothing
 * reports on it. Horizontal from md, vertical on phones.
 */
function Link({ edge, state, stale }: { edge: Edge; state: EdgeState; stale: boolean }) {
  const live = state === "live";
  const flow = live && !stale;
  const label = (
    <span className="rounded bg-base/85 px-1.5 py-px font-mono text-[10.5px] tracking-[.06em] whitespace-nowrap uppercase">
      {live ? "WAL stream" : "replication"}
    </span>
  );
  const detail = (
    <span
      className={cx(
        "rounded bg-base/85 px-1.5 py-px font-mono text-[10.5px] tracking-[.06em] whitespace-nowrap uppercase",
        live ? "text-muted" : LINK_TONE[state],
      )}
    >
      {live ? (edge.detail ?? "streaming") : state === "stopped" ? "stopped" : "no data"}
    </span>
  );
  return (
    <div
      data-edge={`${edge.from}-${edge.to}`}
      data-live={edge.live}
      data-state={state}
      className={cx(
        "relative flex h-[88px] items-center justify-center md:h-full md:flex-col md:gap-1",
        LINK_TONE[state],
      )}
    >
      <span className="hidden md:inline">{label}</span>
      <span aria-hidden="true" className="relative h-full w-0.5 md:h-0.5 md:w-[92px]">
        {live ? (
          <>
            <span className="absolute -inset-[2px] rounded-full bg-current/25" />
            <span
              className={cx(
                "absolute inset-0 bg-[repeating-linear-gradient(180deg,currentColor_0_6px,transparent_6px_11px)] bg-size-[2px_11px] md:bg-[repeating-linear-gradient(90deg,currentColor_0_6px,transparent_6px_11px)] md:bg-size-[11px_2px]",
                flow && "motion-safe:animate-kit-flow-y md:motion-safe:animate-kit-flow-x",
              )}
            />
            <span className="absolute -bottom-1 -left-1 border-x-[5px] border-t-[7px] border-x-transparent border-t-current md:top-[-4px] md:-right-1 md:bottom-auto md:left-auto md:border-y-[5px] md:border-r-0 md:border-l-[7px] md:border-y-transparent md:border-l-current" />
          </>
        ) : state === "stopped" ? (
          <>
            <span className="absolute inset-0 bg-[linear-gradient(180deg,currentColor_0_36%,transparent_36%_64%,currentColor_64%_100%)] md:bg-[linear-gradient(90deg,currentColor_0_36%,transparent_36%_64%,currentColor_64%_100%)]" />
            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-lg leading-none font-bold">
              ×
            </span>
          </>
        ) : (
          <span className="absolute inset-0 bg-[repeating-linear-gradient(180deg,currentColor_0_2px,transparent_2px_5px)] opacity-70 md:bg-[repeating-linear-gradient(90deg,currentColor_0_2px,transparent_2px_5px)]" />
        )}
      </span>
      <span className="hidden md:inline">{detail}</span>
      <span className="absolute top-1/2 left-[calc(50%+18px)] flex -translate-y-1/2 flex-col items-start gap-1 md:hidden">
        {label}
        {detail}
      </span>
    </div>
  );
}

/** The serving node, the fence decision and the replication link, one cell each (two by two on phones). */
function FactsRow({
  topo,
  edge,
  state,
}: {
  topo: TopologyView | null;
  edge: Edge | undefined;
  state: EdgeState | undefined;
}) {
  if (!topo) return null;
  const cells: { k: string; v: ReactNode }[] = [
    { k: "Serving", v: topo.nodes.find((n) => n.note === "serving")?.label ?? DASH },
    {
      k: "Fence",
      v: topo.fence ? (
        <>
          <span className={cx("uppercase", LEVEL_TEXT[topo.fence.level])}>{topo.fence.decision}</span>
          {topo.fence.detail && <span className="text-muted"> · {topo.fence.detail}</span>}
        </>
      ) : (
        DASH
      ),
    },
    {
      k: "Replication",
      v: !edge ? (
        DASH
      ) : state === "unknown" ? (
        <span className="text-muted">no data</span>
      ) : state === "live" ? (
        (edge.detail ?? "streaming")
      ) : (
        <span className="text-down">stopped</span>
      ),
    },
  ];
  return (
    <div className="grid grid-cols-2 border-t border-(--b-hair2) md:grid-cols-3">
      {cells.map((c, i) => (
        <div
          key={c.k}
          className={cx(
            "flex min-w-0 flex-col gap-[5px] border-(--b-hair2) px-3.5 py-[11px]",
            i < cells.length - 1 && "md:border-r",
            i % 2 === 0 && "max-md:border-r",
            i < 2 && "max-md:border-b",
          )}
        >
          <Micro>{c.k}</Micro>
          <span className="truncate font-mono text-[13px]">{c.v}</span>
        </div>
      ))}
    </div>
  );
}
