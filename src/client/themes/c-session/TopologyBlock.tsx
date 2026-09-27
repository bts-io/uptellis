import { EmptyState, Gauge, StateDot } from "@/client/kit";
import type { DisplayState, SiteView, TopologyView } from "@/shared/view";
import { Block, DataAge } from "./Block";
import { cx, DASH, fact, factText, LEVEL_TEXT, levelState, probeStale } from "./format";
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
  const failing =
    view.factGroups.some((g) => g.level === "crit") ||
    topo?.fence?.level === "crit" ||
    (pairEdge !== undefined && !pairEdge.live);
  const shown = (state: DisplayState): DisplayState => (stale ? "stale" : state);

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
      {pairEdge && pair.length === 2 && (
        <div className="flex flex-col items-stretch min-[981px]:flex-row min-[981px]:items-center">
          <div className="flex flex-col items-stretch md:flex-row md:items-center">
            <NodeBox view={view} node={pair[0]!} stale={stale} />
            <EdgeLine edge={pairEdge} stale={stale} replication={factText(view, "replication.state")} />
            <NodeBox view={view} node={pair[1]!} stale={stale} />
          </div>
          {topo?.fence && <FenceStamp view={view} fence={topo.fence} stale={stale} />}
        </div>
      )}
      {topo?.fence && !pairEdge && <FenceStamp view={view} fence={topo.fence} stale={stale} />}
      {view.factGroups.length > 0 && <InfraFacts view={view} stale={stale} />}
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

function NodeBox({ view, node, stale }: { view: SiteView; node: Node; stale: boolean }) {
  const serving = node.note === "serving";
  const role = node.roles[0] ?? "node";
  const mark = role === "primary" ? "◆" : role === "standby" ? "◇" : "";
  const healthz = fact(view, "forgejo.healthzCode");
  const detail = serving ? (
    <>
      forgejo {factText(view, "forgejo.version")}{" "}
      {healthz && (
        <span className={cx(!stale && healthz.level && LEVEL_TEXT[healthz.level])}>{healthz.display}</span>
      )}
    </>
  ) : node.state === "down" ? (
    <span className={cx(!stale && "text-down")}>pg unreachable</span>
  ) : node.state === "degraded" ? (
    <span className={cx(!stale && "text-degraded")}>pg not streaming</span>
  ) : (
    `pg ${node.note === "standby" ? "hot standby" : (node.note ?? DASH)}`
  );
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

/** The replication link: a dashed line that flows while live (never stale, never under reduced motion), else broken. */
function EdgeLine({ edge, stale, replication }: { edge: Edge; stale: boolean; replication: string }) {
  const tone = stale ? "text-faint" : edge.live ? "text-up" : "text-down";
  const label = edge.live
    ? [edge.label ?? (replication === DASH ? "streaming" : replication), edge.detail]
        .filter(Boolean)
        .join(" · ")
    : ["stopped", edge.detail].filter(Boolean).join(" · ");
  return (
    <div
      data-edge={`${edge.from}-${edge.to}`}
      data-live={edge.live}
      className={cx(
        "flex min-w-0 items-center justify-center gap-3 py-2.5 md:w-[300px] md:max-w-[300px] md:min-w-[150px] md:flex-col md:gap-1.5 md:px-2.5 md:py-0",
        tone,
      )}
    >
      <span className="font-mono text-[11.5px] leading-none whitespace-nowrap max-md:order-2">{label}</span>
      <span aria-hidden="true" className="relative block h-[52px] w-0.5 md:h-0.5 md:w-full">
        {edge.live ? (
          <span
            className={cx(
              "absolute inset-0 bg-[repeating-linear-gradient(180deg,currentColor_0_7px,transparent_7px_12px)] bg-size-[2px_12px] md:bg-[repeating-linear-gradient(90deg,currentColor_0_7px,transparent_7px_12px)] md:bg-size-[12px_2px]",
              !stale && "motion-safe:animate-kit-flow-y md:motion-safe:animate-kit-flow-x",
            )}
          />
        ) : (
          <>
            <span className="absolute inset-x-0 top-0 h-[40%] bg-current md:inset-y-0 md:right-auto md:left-0 md:h-full md:w-[41%]" />
            <span className="absolute inset-x-0 bottom-0 h-[40%] bg-[repeating-linear-gradient(180deg,currentColor_0_3px,transparent_3px_8px)] opacity-50 md:inset-y-0 md:right-0 md:left-auto md:h-full md:w-[41%] md:bg-[repeating-linear-gradient(90deg,currentColor_0_3px,transparent_3px_8px)]" />
            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[55%] font-mono text-base leading-none font-bold">
              ×
            </span>
          </>
        )}
        <span className="absolute -bottom-1 -left-[4px] border-x-[5px] border-t-[8px] border-x-transparent border-t-current md:top-[-4px] md:-right-1 md:bottom-auto md:left-auto md:border-y-[5px] md:border-r-0 md:border-l-[8px] md:border-y-transparent md:border-l-current" />
      </span>
    </div>
  );
}

function FenceStamp({
  view,
  fence,
  stale,
}: {
  view: SiteView;
  fence: NonNullable<TopologyView["fence"]>;
  stale: boolean;
}) {
  const t = (key: string) => factText(view, `fence.${key}`);
  const detail = [fence.reason, `tl ${t("timeline")}/${t("peerTimeline")}`].filter(Boolean).join(" · ");
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

function InfraFacts({ view, stale }: { view: SiteView; stale: boolean }) {
  const t = (key: string) => factText(view, key);
  const tone = (key: string) => {
    const l = fact(view, key)?.level;
    return !stale && l ? LEVEL_TEXT[l] : undefined;
  };
  const disk = fact(view, "disk.percent");
  const diskNode = fact(view, "forgejo.node");
  const runners = fact(view, "runners.online");
  return (
    <KeyValues
      className="mt-5 border-t border-dashed border-hair pt-4"
      items={[
        {
          label: "backup",
          value: (
            <>
              <span className={tone("backup.lastResult")}>
                {t("backup.lastResult") === "ok" ? "✓" : t("backup.lastResult")}
              </span>{" "}
              {t("backup.snapshot")} · {t("backup.size")} in {t("backup.durationS")} · {t("backup.lastAt")} ·
              next <span className={tone("backup.nextAt")}>{t("backup.nextAt")}</span>
            </>
          ),
        },
        {
          label: "runners",
          value: (
            <span className="[&>*]:mr-2 md:inline-flex md:items-center md:gap-2 md:[&>*]:mr-0">
              <StateDot state={stale ? "stale" : levelState(runners?.level)} />
              {t("runners.online")} online <span className="text-muted">· {t("runners.list")}</span>
            </span>
          ),
        },
        {
          label: diskNode ? `disk ${diskNode.display}` : "disk",
          value: (
            <span className="[&>*]:mr-2 md:inline-flex md:items-center md:gap-2 md:[&>*]:mr-0">
              {disk?.percent != null && (
                <Gauge
                  value={disk.percent}
                  cells={18}
                  level={stale ? "info" : (disk.level ?? undefined)}
                  label="disk used"
                />
              )}
              <span className={tone("disk.percent")}>{t("disk.percent")}</span>
              <span className="text-muted">
                {t("disk.usedBytes")} / {t("disk.sizeBytes")}
              </span>
            </span>
          ),
        },
        {
          label: "watchdog",
          value: <span className={tone("watchdog.reachable")}>{t("watchdog.reachable")}</span>,
        },
      ]}
    />
  );
}
