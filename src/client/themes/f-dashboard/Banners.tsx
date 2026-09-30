import { useAgeTicker } from "@/client/effects";
import type { IncidentView, SiteView } from "@/shared/view";
import { allServices, dur, isoBefore, LEVEL_TONE, TONE_FILL, when } from "./format";
import { CardHead, Glyph } from "./ui";

const BANNER =
  "mb-4 flex items-start gap-3.5 rounded-[18px] border px-5 py-4 shadow-(--f-shadow) max-sm:px-4 max-sm:gap-3";
const BANNER_ICON = "grid size-9 flex-none place-items-center rounded-[10px]";

/**
 * The stale (or aging, or empty) alert: how old the newest report is against its expected interval. Hidden
 * while fresh, and while a maintenance window covers the whole site. The visible age ticks every 15 s.
 */
export function StaleNotice({ view }: { view: SiteView }) {
  const f = view.freshness;
  const age = useAgeTicker(isoBefore(view.now, f.ageS ?? 0), view.now, 15_000);
  if (f.state === "fresh" || f.quietForMaintenance) return null;
  const src = f.perSource.find((s) => s.id === f.stalestSourceId);
  const title =
    f.state === "aging"
      ? "Data is getting old"
      : f.state === "empty"
        ? "No data has been received"
        : "This data is out of date";
  return (
    <section
      role="alert"
      data-state={f.state}
      aria-labelledby="f-stale-h"
      className={`${BANNER} border-[color-mix(in_srgb,var(--color-degraded)_50%,transparent)] bg-(--f-degraded-soft)`}
    >
      <span className={`${BANNER_ICON} bg-degraded text-(--f-on-amber)`}>
        <Glyph name="clock" size={20} />
      </span>
      <div className="min-w-0">
        <h2 id="f-stale-h" className="m-0 text-base font-extrabold text-(--f-degraded-text)">
          {title}
        </h2>
        <p className="m-0 mt-0.5 text-sm text-(--f-text-2)">
          {f.ageS === null ? (
            "No monitoring source has reported yet."
          ) : (
            <>
              The newest report from {src ? src.id : "a monitoring source"} is <strong>{dur(age)}</strong> old
              {src ? ` (expected every ${dur(src.expectedIntervalS)})` : ""}. Service states below are from
              the last report and may not reflect what is happening now.
            </>
          )}
        </p>
      </div>
    </section>
  );
}

/** One blue banner per active maintenance window: its title, start and end, and what it covers. */
export function MaintenanceBanners({ view }: { view: SiteView }) {
  const list = view.maintenance ?? [];
  if (!list.length) return null;
  const names = new Map(allServices(view).map((s) => [s.id, s.name]));
  return list.map((m) => {
    const covers = m.services.length
      ? m.services.map((id) => names.get(id) ?? id).join(", ")
      : "All services";
    return (
      <section
        key={m.id}
        role="status"
        aria-label="Scheduled maintenance"
        data-maintenance=""
        className={`${BANNER} border-[color-mix(in_srgb,var(--color-maint)_45%,transparent)] bg-(--f-maint-soft)`}
      >
        <span className={`${BANNER_ICON} bg-maint text-white`}>
          <Glyph name="wrench" size={20} />
        </span>
        <div className="min-w-0">
          <h2 className="m-0 text-base font-extrabold text-(--f-maint-text)">Maintenance: {m.title}</h2>
          <p className="m-0 mt-0.5 text-sm text-(--f-text-2)">
            {when(m.start)} to {when(m.end)}. Affects: {covers}.
          </p>
        </div>
      </section>
    );
  });
}

/** Open incidents in a red-tinted card: title, subject, start, the ticking duration, notes and steps. */
export function OpenIncidents({ view }: { view: SiteView }) {
  const list = view.incidents.open;
  if (!list.length) return null;
  return (
    <section
      aria-labelledby="f-oi-h"
      className="mb-4 min-w-0 rounded-[18px] border border-[color-mix(in_srgb,var(--color-down)_55%,var(--color-line))] bg-[linear-gradient(0deg,var(--f-down-soft),var(--f-down-soft)),var(--color-panel)] p-4 shadow-(--f-shadow) sm:p-5"
    >
      <CardHead
        id="f-oi-h"
        title={
          <span className="flex items-center gap-2 text-(--f-down-text)">
            <Glyph name="alert" size={16} />
            Active incident{list.length > 1 ? `s (${list.length})` : ""}
          </span>
        }
        hint="Live"
      />
      <div className="flex flex-col gap-2.5">
        {list.map((i) => (
          <OpenIncident key={i.id} view={view} incident={i} />
        ))}
      </div>
    </section>
  );
}

function OpenIncident({ view, incident: i }: { view: SiteView; incident: IncidentView }) {
  const open = useAgeTicker(i.startedAt, view.now, 15_000);
  return (
    <article
      data-incident={i.id}
      className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-xl border border-line bg-panel px-4 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <h3 className="m-0 text-base font-bold">{i.title}</h3>
        <p className="m-0 text-[13px] text-(--f-text-2)">
          {i.subject} · started {when(i.startedAt)}
        </p>
      </div>
      <div className="sm:text-right">
        <strong className="block text-xl font-extrabold text-(--f-down-text) tabular-nums">
          {dur(open)}
        </strong>
        <span className="text-xs text-muted">ongoing</span>
      </div>
      {i.notes && <p className="m-0 text-[13.5px] text-(--f-text-2) sm:col-span-2">{i.notes}</p>}
      <ol className="m-0 mt-1.5 flex list-none flex-wrap gap-x-3.5 gap-y-1.5 p-0 text-[12.5px] text-(--f-text-2) sm:col-span-2">
        {i.steps.map((s) => (
          <li key={`${s.ts}-${s.label}`} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{ background: TONE_FILL[LEVEL_TONE[s.level]] }}
            />
            <strong>{s.label}</strong> {when(s.ts)}
          </li>
        ))}
      </ol>
    </article>
  );
}
