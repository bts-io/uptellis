import { ActivityFeed, EmptyState, Footer, IncidentRail, Panel, StaleBanner, StateDot } from "@/client/kit";
import type { SiteView } from "@/shared/view";
import type { ThemePageProps } from "../types";
import { cx, DASH, factText, isStale } from "./format";
import { Header } from "./Header";
import { HostsPanel } from "./HostsPanel";
import { InfraPanel } from "./InfraPanel";
import { MonitorsPanel } from "./MonitorsPanel";
import { SummaryBox } from "./SummaryBox";
import { useCardKeys } from "./useCardKeys";
import { Wrap } from "./Wrap";

/** Activity rows on desktop (two columns of six); phones show the first six. */
const ACTIVITY_ROWS = 12;

const HINTS = [
  { keys: "j k", label: "cards" },
  { keys: "Enter", label: "expand" },
  { keys: "i", label: "infra" },
];

const LEGEND = [
  { char: "+", label: "up", className: "text-up" },
  { char: "~", label: "degraded", className: "text-degraded" },
  { char: "x", label: "down", className: "text-down" },
  { char: "=", label: "maint", className: "text-maint" },
  { char: ".", label: "no data", className: "text-faint" },
];

/** Events older than this leave the activity panel to the checks (the panel is a live tail, not a history). */
const EVENT_WINDOW_MS = 24 * 3600_000;

/** Status changes and incidents of the last day, at most half the rows (checks keep the tail live). */
function recentEvents(view: SiteView) {
  const since = Date.parse(view.now) - EVENT_WINDOW_MS;
  return view.activity.filter((a) => Date.parse(a.ts) >= since).slice(0, ACTIVITY_ROWS / 2);
}

/** The newest checks across every service, newest first; they fill the activity rows the events leave. */
function recentChecks(view: SiteView) {
  return [...view.sections.flatMap((s) => s.services), ...view.unsectioned]
    .flatMap((s) => s.recent.map((beat) => ({ id: s.id, service: s.name, beat })))
    .sort((a, b) => b.beat.ts.localeCompare(a.beat.ts))
    .slice(0, ACTIVITY_ROWS);
}

/** Theme A "sys.status": the console layout of mockups/A over `SiteView`. */
export function Page({ view, commit }: ThemePageProps) {
  useCardKeys();
  const stale = isStale(view);
  const collector = factText(view, "kuma.host");
  const events = recentEvents(view);
  const checks = recentChecks(view);

  return (
    <div className="min-h-dvh overflow-x-hidden bg-base font-mono text-[13px] leading-[1.55] text-ink tabular-nums antialiased selection:bg-accent/25">
      <Header view={view} />

      {stale && (
        <Wrap className="mt-[22px]">
          <StaleBanner freshness={view.freshness} now={view.now} generatedAt={view.generatedAt} />
        </Wrap>
      )}

      {view.incidents.open.map((incident) => (
        <Wrap key={incident.id} className="mt-[34px]">
          <Panel
            title="incident"
            level="crit"
            aside={
              <span className="inline-flex items-center gap-1.5 font-bold tracking-[.06em] text-down">
                <StateDot state="down" pulse label="open" />
                OPEN
              </span>
            }
            className="[--kit-in:var(--a-incident)]"
          >
            <IncidentRail incident={incident} now={view.now} />
          </Panel>
        </Wrap>
      ))}

      <Wrap className="mt-[38px] flex flex-col gap-[34px]">
        <SummaryBox view={view} />

        {/* DOM order is the phone order (infra, monitors, hosts); from 1181px monitors take the left column. */}
        <div className="grid grid-cols-1 items-start gap-[34px] min-[1181px]:grid-cols-[minmax(0,1fr)_480px] min-[1181px]:grid-rows-[auto_1fr] min-[1181px]:gap-x-6">
          <div className="min-[1181px]:col-start-2 min-[1181px]:row-start-1">
            <InfraPanel view={view} />
          </div>
          <div className="min-[1181px]:col-start-1 min-[1181px]:row-span-2 min-[1181px]:row-start-1">
            <MonitorsPanel view={view} />
          </div>
          <div className="min-[1181px]:col-start-2 min-[1181px]:row-start-2">
            <HostsPanel view={view} />
          </div>
        </div>

        <Panel title="activity" aside="newest first · UTC" className={cx(stale && "border-dashed")}>
          {events.length || checks.length ? (
            <div className={cx("max-md:[&_li:nth-child(n+7)]:hidden", stale && "saturate-[.4]")}>
              <ActivityFeed items={events} checks={checks} now={view.now} limit={ACTIVITY_ROWS} columns={2} />
            </div>
          ) : (
            <EmptyState
              title="No activity yet"
              detail="Checks, status changes and incidents show here as they happen."
            />
          )}
        </Panel>
      </Wrap>

      <Wrap className="mt-10">
        <Footer
          generatedAt={view.generatedAt}
          collectorHost={collector === DASH ? null : collector}
          commit={commit}
          hints={HINTS}
        />
        <p className="-mt-6 pb-[30px] text-right text-[11.5px] text-faint max-[760px]:mt-0 max-[760px]:text-left">
          beat legend{" "}
          {LEGEND.map((l) => (
            <span key={l.char} className="ml-2.5">
              <b className={l.className}>{l.char}</b> {l.label}
            </span>
          ))}
        </p>
      </Wrap>
    </div>
  );
}
