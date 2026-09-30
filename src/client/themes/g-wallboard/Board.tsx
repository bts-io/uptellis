import { type CSSProperties, useRef } from "react";
import type { SiteView } from "@/shared/view";
import {
  type BoardGroup,
  boardGroups,
  cx,
  factsStale,
  groupSize,
  groupState,
  PAGE_MS,
  RANK,
  WORD,
} from "./format";
import { FactTile, ServiceTile } from "./Tile";
import { usePaging } from "./usePaging";

const GROUP_STATE: Record<string, string> = {
  up: "text-up",
  degraded: "text-degraded",
  pending: "text-degraded",
  down: "text-down",
  maintenance: "text-maint",
  stale: "text-stale",
  paused: "text-(--g-unknown)",
  unknown: "text-(--g-unknown)",
};

/**
 * The services grid: one group per section (then "Other" and "Infrastructure"), four columns on a wall,
 * two from 900 px, stacked below. On a wall screen the groups that do not fit rotate in pages (usePaging),
 * and the board never shrinks below one full row of tiles (`--g-board-min`, tokens.css): the alerts and the
 * recent incidents give way first (Alerts, History).
 */
export function Board({ view }: { view: SiteView }) {
  const groups = boardGroups(view);
  const grid = useRef<HTMLDivElement>(null);
  const ranks = groups.map((g) => RANK[g.state]);
  const signature = groups.map((g) => `${g.id}:${g.state}:${groupSize(g)}`).join("|");
  const { pages, page, turn, running, go } = usePaging(grid, ranks, signature);
  const shown = pages?.[page];
  const titles = shown?.map((i) => groups[i]?.title).join(", ");

  return (
    <section
      aria-labelledby="g-services"
      className="flex min-h-0 flex-1 flex-col gap-2.5 min-[900px]:min-h-(--g-board-min)"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="g-services" className="text-[1.1rem] font-bold tracking-[0.16em] text-muted uppercase">
          Services
        </h2>
        <div hidden={!pages} data-pager="" className="flex items-center gap-2.5 text-[1.2rem] text-muted">
          <PagerButton label="Previous page" onClick={() => go(-1)}>
            &#8249;
          </PagerButton>
          <p aria-live="polite">{pages && `Page ${page + 1} of ${pages.length}: ${titles}`}</p>
          <PagerButton label="Next page" onClick={() => go(1)}>
            &#8250;
          </PagerButton>
          {running && (
            <span aria-hidden="true" className="h-[0.3rem] w-24 overflow-hidden rounded-full bg-line">
              <span
                key={turn}
                className="block h-full w-0 bg-ink motion-safe:animate-[g-fill_var(--g-page-ms)_linear_forwards]"
                style={{ "--g-page-ms": `${PAGE_MS}ms` } as CSSProperties}
              />
            </span>
          )}
        </div>
      </div>

      <div
        ref={grid}
        className="grid grid-cols-1 content-start gap-5 min-[900px]:min-h-0 min-[900px]:flex-1 min-[900px]:grid-cols-2 min-[900px]:gap-4 min-[900px]:overflow-hidden min-[1101px]:grid-cols-4"
      >
        {groups.map((g, i) => (
          <Group key={g.id} group={g} view={view} hidden={shown ? !shown.includes(i) : undefined} />
        ))}
      </div>
    </section>
  );
}

function PagerButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="size-[2.2rem] cursor-pointer rounded-full border-[0.12rem] border-line bg-panel text-[1.6rem] leading-none text-ink focus-visible:outline-[0.2rem] focus-visible:outline-offset-[0.15rem] focus-visible:outline-ink"
    >
      {children}
    </button>
  );
}

function Group({
  group: g,
  view,
  hidden,
}: {
  group: BoardGroup;
  view: SiteView;
  hidden: boolean | undefined;
}) {
  const span = groupSize(g);
  const stale = g.kind === "facts" && factsStale(view);
  return (
    <section
      aria-label={g.title}
      data-g-group={g.id}
      hidden={hidden}
      style={{ "--g-span": span } as CSSProperties}
      className="col-span-full flex min-w-0 flex-col gap-2 min-[1101px]:col-span-(--g-span)"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[1.5rem] font-bold">{g.title}</h2>
        <span
          className={cx(
            "text-[1.1rem] font-bold tracking-[0.1em] whitespace-nowrap uppercase",
            GROUP_STATE[g.state],
          )}
        >
          {g.state === "up" ? "All up" : g.kind === "facts" && g.state === "down" ? "Failing" : WORD[g.state]}
        </span>
      </div>
      <ul
        style={{ "--g-cols": `repeat(${span}, minmax(0, 1fr))` } as CSSProperties}
        className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-(--g-cols)"
      >
        {g.kind === "services"
          ? g.services.map((s) => <ServiceTile key={s.id} service={s} />)
          : g.groups.map((f) => <FactTile key={f.id} group={f} state={groupState(f, stale)} />)}
      </ul>
    </section>
  );
}
