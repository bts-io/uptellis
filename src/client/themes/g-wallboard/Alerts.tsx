import type { ReactNode } from "react";
import { useAgeTicker } from "@/client/effects";
import type { IncidentView, SiteView } from "@/shared/view";
import { ago, allServices, clock, cx, isFresh, isoBefore, until } from "./format";
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

/** One full-width alert row: icon, a tag, the title in bold, the detail muted. */
function Alert({
  kind,
  icon,
  tag,
  title,
  meta,
  data,
}: {
  kind: Kind;
  icon: IconName;
  tag: string;
  title: ReactNode;
  meta: ReactNode;
  data?: Record<string, string>;
}) {
  const k = KIND[kind];
  return (
    <div
      {...data}
      role={kind === "maint" ? "status" : "alert"}
      className={cx(
        "flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border-l-[0.6rem] px-[0.9rem] py-[0.7rem] text-[1.25rem] font-bold min-[900px]:px-5 min-[900px]:py-3 min-[900px]:text-[1.6rem]",
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
      <span className="min-w-0">{title}</span>
      <span className="text-[1.05rem] font-medium text-muted min-[900px]:text-[1.3rem]">{meta}</span>
    </div>
  );
}

/** Open incidents first, then the stale notice, then active maintenance windows; nothing when all is calm. */
export function Alerts({ view }: { view: SiteView }) {
  const open = view.incidents.open;
  const stale = !isFresh(view);
  const windows = view.maintenance ?? [];
  if (!open.length && !stale && !windows.length) return null;
  const names = new Map(allServices(view).map((s) => [s.id, s.name]));
  return (
    <div className="flex flex-col gap-2.5">
      {open.map((i) => (
        <IncidentAlert key={i.id} incident={i} now={view.now} />
      ))}
      {stale && <StaleAlert view={view} />}
      {windows.map((m) => (
        <Alert
          key={m.id}
          kind="maint"
          icon="maintenance"
          tag="Maintenance"
          title={m.title}
          meta={`${m.services.length ? m.services.map((id) => names.get(id) ?? id).join(", ") : "All services"} · until ${until(m.end, view.now)}`}
          data={{ "data-maintenance": "" }}
        />
      ))}
    </div>
  );
}

function IncidentAlert({ incident: i, now }: { incident: IncidentView; now: string }) {
  const open = useAgeTicker(i.startedAt, now);
  return (
    <Alert
      kind="incident"
      icon="down"
      tag="Open incident"
      title={i.title}
      meta={`${i.subject} · for ${ago(open)} · since ${clock(i.startedAt)}`}
      data={{ "data-incident": i.id }}
    />
  );
}

function StaleAlert({ view }: { view: SiteView }) {
  const f = view.freshness;
  const age = useAgeTicker(isoBefore(view.now, f.ageS ?? 0), view.now, 5000);
  const silent = f.perSource
    .filter((p) => p.freshness === "stale" || p.freshness === "empty")
    .map((p) => p.id);
  const empty = f.state === "empty";
  return (
    <Alert
      kind="stale"
      icon="stale"
      tag={empty ? "No data" : "Stale data"}
      title={empty ? "No source has reported yet" : `Data is ${ago(f.ageS === null ? null : age)} old`}
      meta={`${silent.length ? `Not reporting: ${silent.join(", ")} · ` : ""}last snapshot ${clock(view.generatedAt)}`}
      data={{ "data-stale": f.state }}
    />
  );
}
