import { Age } from "@/client/kit";
import type { IncidentView, SiteView } from "@/shared/view";
import { allServices, DASH, hhmmss } from "./format";
import { Chip, Tile } from "./ui";

/** An open incident across the page: what failed, where, since when, how many failed checks, its last step. */
export function IncidentRow({ view, incident }: { view: SiteView; incident: IncidentView }) {
  const service = allServices(view).find((s) => s.id === incident.serviceId);
  const failed = service ? service.recent.findIndex((b) => b.status !== "down") : -1;
  const failedChecks = service ? (failed < 0 ? service.recent.length : failed) : null;
  const step = incident.steps.at(-1);
  const detail =
    incident.notes ?? (service?.recent[0]?.message ? `latest check: ${service.recent[0].message}` : null);

  return (
    <Tile
      down
      aria-label="Active incident"
      className="flex flex-wrap items-center gap-3.5 px-4 py-[13px] max-md:flex-col max-md:items-start max-md:gap-2.5"
    >
      <Chip level="crit">● incident</Chip>
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] font-semibold">
          {incident.title}
          {service?.targetDisplay && (
            <span className="ml-1.5 inline-block font-mono text-xs font-normal whitespace-nowrap text-muted">
              {service.targetDisplay}
            </span>
          )}
        </div>
        {detail && <div className="mt-0.5 text-[13px] text-muted">{detail}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {step && <Chip level="warn">{step.label}</Chip>}
        <Chip>since {hhmmss(incident.startedAt)} UTC</Chip>
        <Chip>
          open <Age since={incident.startedAt} now={view.now} suffix={false} />
        </Chip>
        <Chip>{failedChecks === null ? DASH : failedChecks} failed checks</Chip>
      </div>
    </Tile>
  );
}
