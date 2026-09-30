import { useAgeTicker } from "@/client/effects";
import type { IncidentView, SiteView } from "@/shared/view";
import {
  type AlertPlan,
  ago,
  alertPlan,
  allServices,
  clock,
  cx,
  isFresh,
  isoBefore,
  silentSources,
  until,
} from "./format";
import { BoardIcon, type IconName } from "./icons";

type Kind = "incident" | "stale" | "maint";

const KIND: Record<Kind, { box: string; icon: string; tag: string }> = {
  incident: {
    box: "border-down bg-(--g-incident-bg)",
    icon: "text-down",
    tag: "bg-down text-(--g-incident-ink)",
  },
  stale: { box: "border-stale bg-(--g-stale-bg)", icon: "text-stale", tag: "bg-stale text-(--g-stale-ink)" },
  maint: { box: "border-maint bg-(--g-maint-bg)", icon: "text-maint", tag: "bg-maint text-(--g-maint-ink)" },
};

/** Why a strip is off the wall (it still shows on a phone): counted in "+M more", or folded into the header. */
type Off = "overflow" | "folded" | undefined;

/**
 * One full-width alert row: icon, a tag, the title in bold, the detail muted. On a wall screen it keeps to
 * one line (title and detail end in an ellipsis, the full text in their title attribute); on a phone it wraps.
 */
function Alert({
  kind,
  icon,
  tag,
  title,
  meta,
  data,
  off,
}: {
  kind: Kind;
  icon: IconName;
  tag: string;
  title: string;
  meta: string;
  data?: Record<string, string>;
  off?: Off;
}) {
  const k = KIND[kind];
  return (
    <div
      {...data}
      {...(off && { [`data-${off}`]: "" })}
      role={kind === "maint" ? "status" : "alert"}
      className={cx(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border-l-[0.6rem] px-[0.9rem] py-[0.7rem] text-[1.25rem] font-bold min-[900px]:flex-nowrap min-[900px]:px-5 min-[900px]:py-3 min-[900px]:text-[1.6rem]",
        off && "min-[900px]:hidden",
        k.box,
      )}
    >
      <BoardIcon name={icon} className={cx("size-8", k.icon)} />
      <span
        className={cx(
          "rounded-md px-2.5 py-0.5 text-[1.1rem] tracking-[0.12em] whitespace-nowrap uppercase",
          k.tag,
        )}
      >
        {tag}
      </span>
      <span
        title={title}
        className="min-w-0 min-[900px]:max-w-[55%] min-[900px]:shrink-0 min-[900px]:truncate"
      >
        {title}
      </span>
      <span
        title={meta}
        className="min-w-0 text-[1.05rem] font-medium text-muted min-[900px]:flex-1 min-[900px]:truncate min-[900px]:text-[1.3rem]"
      >
        {meta}
      </span>
    </div>
  );
}

/**
 * Open incidents first, then the stale notice, then active maintenance windows; nothing when all is calm.
 * Every strip is in the markup (a phone shows them all). A wall screen shows the first `WALL_ALERTS` and one
 * "+M more" row for the rest, and folds the stale notice into the header while incidents are open, so the
 * alerts never push the service tiles off the screen.
 */
export function Alerts({ view }: { view: SiteView }) {
  const open = view.incidents.open;
  const stale = !isFresh(view);
  const windows = view.maintenance ?? [];
  if (!open.length && !stale && !windows.length) return null;
  const names = new Map(allServices(view).map((s) => [s.id, s.name]));
  const plan = alertPlan(view);
  // Position of each strip in the wall's order (the folded stale notice takes none).
  let at = 0;
  const off = (): Off => (at++ < plan.shown ? undefined : "overflow");
  const hiddenTitles: string[] = [];
  const track = (o: Off, what: string) => {
    if (o === "overflow") hiddenTitles.push(what);
    return o;
  };
  return (
    <div data-g-alerts="" className="flex flex-col gap-2.5">
      {open.map((i) => (
        <IncidentAlert key={i.id} incident={i} now={view.now} off={track(off(), i.title)} />
      ))}
      {stale && <StaleAlert view={view} off={plan.staleInHeader ? "folded" : track(off(), "Stale data")} />}
      {windows.map((m) => (
        <Alert
          key={m.id}
          kind="maint"
          icon="maintenance"
          tag="Maintenance"
          title={m.title}
          meta={`${m.services.length ? m.services.map((id) => names.get(id) ?? id).join(", ") : "All services"} · until ${until(m.end, view.now)}`}
          data={{ "data-maintenance": "" }}
          off={track(off(), `Maintenance: ${m.title}`)}
        />
      ))}
      <More plan={plan} titles={hiddenTitles} />
    </div>
  );
}

/** The wall's compact last row: how many strips are not shown, and their titles on one line. */
function More({ plan, titles }: { plan: AlertPlan; titles: string[] }) {
  if (!plan.more) return null;
  const list = titles.join(" · ");
  return (
    <p
      data-more={plan.more}
      title={list}
      className="hidden items-center gap-x-4 rounded-xl border-l-[0.6rem] border-line bg-panel px-5 py-1.5 text-[1.3rem] font-bold min-[900px]:flex"
    >
      <span className="whitespace-nowrap">+{plan.more} more</span>
      <span className="min-w-0 flex-1 truncate font-medium text-muted">{list}</span>
    </p>
  );
}

function IncidentAlert({ incident: i, now, off }: { incident: IncidentView; now: string; off: Off }) {
  const open = useAgeTicker(i.startedAt, now);
  return (
    <Alert
      kind="incident"
      icon="down"
      tag="Open incident"
      title={i.title}
      meta={`${i.subject} · for ${ago(open)} · since ${clock(i.startedAt)}`}
      data={{ "data-incident": i.id }}
      off={off}
    />
  );
}

function StaleAlert({ view, off }: { view: SiteView; off: Off }) {
  const f = view.freshness;
  const age = useAgeTicker(isoBefore(view.now, f.ageS ?? 0), view.now, 5000);
  const silent = silentSources(view);
  const empty = f.state === "empty";
  return (
    <Alert
      kind="stale"
      icon="stale"
      tag={empty ? "No data" : "Stale data"}
      title={empty ? "No source has reported yet" : `Data is ${ago(f.ageS === null ? null : age)} old`}
      meta={`${silent.length ? `Not reporting: ${silent.join(", ")} · ` : ""}last snapshot ${clock(view.generatedAt)}`}
      data={{ "data-stale": f.state }}
      off={off}
    />
  );
}
