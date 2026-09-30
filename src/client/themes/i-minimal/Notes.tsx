import type { SiteView } from "@/shared/view";
import { allServices, cx, dayTime, hhmm, shortDay } from "./format";
import { LiveAge } from "./ui";

/** Under the verdict: counts and the real data age (`8 services, updated 34s ago`); nothing once stale. */
export function VerdictNote({ view }: { view: SiteView }) {
  const { verdict, summary, freshness } = view;
  if (verdict.state === "stale" || verdict.state === "empty") return null;
  const bits: string[] = [];
  if (verdict.down) bits.push(`${verdict.down} down`);
  if (verdict.degraded) bits.push(`${verdict.degraded} degraded`);
  const head =
    verdict.state === "maintenance"
      ? `${summary.maintenance} of ${summary.total} in maintenance`
      : verdict.state === "operational" || !bits.length
        ? `${summary.total} services`
        : `${bits.join(", ")} of ${summary.total}`;
  return (
    <p className="mt-2 mb-0 ml-6 text-sm text-muted">
      {head}
      {freshness.ageS !== null && (
        <>
          , updated <LiveAge seconds={freshness.ageS} now={view.now} />
        </>
      )}
    </p>
  );
}

const NOTE = "mt-5 mb-0 border-l-[3px] px-3.5 py-2.5 text-sm";
const STALE_NOTE = cx(
  NOTE,
  "border-l-degraded bg-[color-mix(in_srgb,var(--color-degraded)_11%,transparent)] [&_strong]:font-semibold [&_strong]:text-(--i-degraded-text)",
);

/**
 * Stale, delayed or never reported (hidden while a window covers the whole site). The stale sentence
 * names the last report plainly: the mock-up wrapped it in stray brackets ("since (Sep 27, 23:57 UTC).").
 */
export function FreshNote({ view }: { view: SiteView }) {
  const f = view.freshness;
  if (f.state === "fresh" || f.quietForMaintenance) return null;
  if (f.state === "empty" || f.ageS === null) {
    return (
      <p role="alert" className={STALE_NOTE}>
        <strong>No data yet.</strong> Waiting for monitoring to report.
      </p>
    );
  }
  const seen = f.perSource.find((s) => s.id === f.stalestSourceId)?.lastSeenAt ?? null;
  if (f.state === "stale") {
    return (
      <p role="alert" className={STALE_NOTE}>
        <strong>
          Last data <LiveAge seconds={f.ageS} now={view.now} />.
        </strong>{" "}
        Monitoring has not reported {seen ? `since ${dayTime(seen)}` : "recently"}. Statuses below are the
        last known and may have changed.
      </p>
    );
  }
  return (
    <p className={STALE_NOTE}>
      <strong>Updates delayed.</strong> Newest data is{" "}
      <LiveAge seconds={f.ageS} now={view.now} suffix={false} /> old{seen ? `, from ${dayTime(seen)}` : ""}.
    </p>
  );
}

/** One line per active maintenance window: title, scope and its end. */
export function MaintNotes({ view }: { view: SiteView }) {
  const windows = view.maintenance ?? [];
  if (!windows.length) return null;
  const names = new Map(allServices(view).map((s) => [s.id, s.name]));
  return (
    <>
      {windows.map((m) => (
        <p
          key={m.id}
          role="status"
          data-maintenance=""
          className={cx(
            NOTE,
            "border-l-maint bg-[color-mix(in_srgb,var(--color-maint)_9%,transparent)] [&_strong]:font-semibold [&_strong]:text-(--i-maint-text)",
          )}
        >
          <strong>Maintenance:</strong> {m.title},{" "}
          {m.services.length ? m.services.map((id) => names.get(id) ?? id).join(", ") : "all services"}, until{" "}
          {shortDay(m.end)} {hhmm(m.end)}.
        </p>
      ))}
    </>
  );
}
