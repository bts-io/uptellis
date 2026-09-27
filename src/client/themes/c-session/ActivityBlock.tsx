import { ActivityFeed, EmptyState } from "@/client/kit";
import type { SiteView } from "@/shared/view";
import { Block, DataAge, kumaSeenAt } from "./Block";
import { activityRows, allServices, cx, hhmmss, isStale } from "./format";

const ROWS = 12;

/** The latest status changes and incidents, then the newest checks: a tail of what the collector saw. */
export function ActivityBlock({ view }: { view: SiteView }) {
  const stale = isStale(view);
  const { events, checks } = activityRows(view, ROWS);
  const newest = checks[0]?.beat.ts ?? view.generatedAt;
  return (
    <Block
      id="activity"
      title="Activity"
      command="tail -f activity"
      aside={
        <>
          <span>
            {stale ? "paused" : "following"} · <DataAge view={view} since={kumaSeenAt(view)} stale={stale} />
          </span>
          <span
            className={cx(
              "rounded px-[7px] py-[3px] leading-none font-semibold",
              stale ? "bg-muted/10 text-faint" : "bg-accent/8 text-accent",
            )}
          >
            live
          </span>
        </>
      }
      stale={stale}
    >
      {events.length || checks.length ? (
        <>
          <div className="md:[&_li]:grid-cols-[80px_64px_180px_minmax(0,1fr)_88px]">
            <ActivityFeed items={events} checks={checks} now={view.now} limit={ROWS} />
          </div>
          <p className="m-0 mt-2.5 font-mono text-xs leading-none text-faint">
            {stale
              ? `stream paused · no checks since ${hhmmss(newest)} UTC`
              : `following ${allServices(view).length} monitors · newest first`}
          </p>
        </>
      ) : (
        <EmptyState
          title="No activity yet"
          detail="Checks, status changes and incidents show here as they happen."
        />
      )}
    </Block>
  );
}
