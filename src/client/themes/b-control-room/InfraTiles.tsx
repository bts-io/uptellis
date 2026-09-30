import { StateDot, SummaryParts } from "@/client/kit";
import type { FactGroupView, Level, SiteView } from "@/shared/view";
import { cx, DASH, LEVEL_TEXT, levelState, probeStale } from "./format";
import { Chip, Kv, Micro, Tile, TileHead } from "./ui";

const CHIP_TEXT: Record<Level, string | null> = { ok: "ok", warn: "warning", crit: "failing", info: null };

/**
 * One fact group: its title and a chip with its level, the profile's summary in coloured parts (wrapping, a
 * dot before a first part that has no colour of its own, `2 of 2 online`), then every row with its level dot
 * and a warning or failure in its colour.
 */
export function GroupTile({
  view,
  group,
  className,
}: {
  view: SiteView;
  group: FactGroupView;
  className?: string;
}) {
  const stale = probeStale(view) || !group.fresh;
  const chip = CHIP_TEXT[group.level];
  const [lead] = group.summaryParts;
  return (
    <Tile stale={stale} className={className}>
      <TileHead>
        <Micro>{group.title}</Micro>
        {chip && <Chip level={stale ? "info" : group.level}>{chip}</Chip>}
      </TileHead>
      <div className="px-4 pt-2 pb-3.5">
        {lead && (
          <div className="font-mono text-[13px] leading-normal text-ink [overflow-wrap:anywhere]">
            {lead.level === null && (
              <span className="mr-2 inline-flex align-middle">
                <StateDot state={stale ? "stale" : levelState(group.level)} />
              </span>
            )}
            <SummaryParts parts={group.summaryParts} stale={stale} />
          </div>
        )}
        <div className={cx(lead && "mt-2")}>
          {group.rows.map((r) => (
            <Kv key={r.key} k={r.label.toLowerCase()}>
              {r.level && r.level !== "info" && <StateDot state={stale ? "stale" : levelState(r.level)} />}
              <span
                className={cx(
                  "truncate",
                  !stale && (r.level === "warn" || r.level === "crit") && LEVEL_TEXT[r.level],
                )}
              >
                {r.display || DASH}
              </span>
            </Kv>
          ))}
        </div>
      </div>
    </Tile>
  );
}

/** The machines of the topology (tailnet hostnames only): state, roles, location. */
export function TailnetTile({ view }: { view: SiteView }) {
  const stale = probeStale(view);
  const nodes = view.topology?.nodes ?? [];
  const up = nodes.filter((n) => n.state === "up").length;
  return (
    <Tile stale={stale} className="min-[1100px]:col-span-4">
      <TileHead>
        <Micro>Tailnet</Micro>
        <span className="font-mono text-xs">
          <b className="font-medium">{up}</b>
          <span className="text-muted">/{nodes.length} up</span>
        </span>
      </TileHead>
      <div className="px-4 pt-3 pb-3.5">
        {nodes.length ? (
          <>
            <div className="mb-2.5 flex gap-2 [&>span]:size-2.5">
              {nodes.map((n) => (
                <StateDot key={n.id} state={stale ? "stale" : n.state} label={`${n.label} ${n.state}`} />
              ))}
            </div>
            {nodes.map((n) => (
              <Kv
                key={n.id}
                k={
                  <span className="flex items-center gap-2 text-ink">
                    <StateDot state={stale ? "stale" : n.state} />
                    {n.label}
                  </span>
                }
              >
                <span className="truncate">
                  <span className="text-muted">{n.roles.join(" + ")}</span>
                  {n.location && ` · ${n.location}`}
                </span>
              </Kv>
            ))}
          </>
        ) : (
          <Kv k="machines">{DASH}</Kv>
        )}
      </div>
    </Tile>
  );
}
