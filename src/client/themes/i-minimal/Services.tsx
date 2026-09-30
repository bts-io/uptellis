import type { BeatDay, ServiceView, SiteView } from "@/shared/view";
import { cellTitle, cx, meanUptime, pct } from "./format";
import { Label, State } from "./ui";

/** Sections as small labelled lists: name, a tiny 90-day strip, the state word. */
export function Services({ view }: { view: SiteView }) {
  const any = view.sections.some((s) => s.services.length) || view.unsectioned.length > 0;
  return (
    <section aria-labelledby="i-h-svc" className="mt-12 max-[560px]:mt-[38px]">
      <h2 id="i-h-svc" className="sr-only">
        Services
      </h2>
      <div className="flex flex-col gap-[26px]">
        {view.sections.map((s) => (
          <Group key={s.id} title={s.title} services={s.services} />
        ))}
        <Group title="Other" services={view.unsectioned} />
      </div>
      {any ? (
        <div aria-hidden="true" className="mt-2 flex justify-between text-xs text-faint">
          <span>90 days ago</span>
          <span>today</span>
        </div>
      ) : (
        <p className="m-0 text-sm text-muted">No services are monitored yet.</p>
      )}
    </section>
  );
}

function Group({ title, services }: { title: string; services: ServiceView[] }) {
  if (!services.length) return null;
  return (
    <section aria-label={title}>
      <Label as="h3">{title}</Label>
      <ul className="m-0 list-none p-0">
        {services.map((s) => (
          <Row key={s.id} service={s} />
        ))}
      </ul>
    </section>
  );
}

function Row({ service: s }: { service: ServiceView }) {
  return (
    <li
      id={`svc-${s.id}`}
      className="grid scroll-mt-4 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 border-t border-line py-[9px] last:border-b max-[560px]:grid-cols-[minmax(0,1fr)_auto] max-[560px]:gap-y-[7px] max-[560px]:py-[11px]"
    >
      <span title={s.name} className="min-w-0 truncate">
        {s.name}
      </span>
      <Strip service={s} />
      <State state={s.state} />
    </li>
  );
}

const CELL: Record<NonNullable<BeatDay["worst"]> | "none", string> = {
  up: "bg-[color-mix(in_srgb,var(--color-up)_55%,var(--i-cell-none))]",
  degraded: "bg-degraded",
  pending: "bg-degraded",
  down: "bg-down",
  maintenance: "bg-maint",
  paused: "bg-(--i-cell-none)",
  unknown: "bg-(--i-cell-none)",
  none: "bg-(--i-cell-none)",
};

/** 90 hairline cells, oldest first; 180 px beside the name, full width under it on a phone. */
function Strip({ service: s }: { service: ServiceView }) {
  const up = meanUptime(s.beats90d);
  return (
    <span
      role="img"
      aria-label={`${s.name}, last 90 days: ${up === null ? "no data" : `${pct(up)} uptime`}`}
      data-beats={s.beatsText}
      className="flex h-3 w-[180px] gap-px max-[560px]:col-span-full max-[560px]:row-start-2 max-[560px]:h-2.5 max-[560px]:w-full"
    >
      {s.beats90d.map((b) => (
        <span
          key={b.day}
          data-w={b.worst ?? "none"}
          title={cellTitle(b)}
          className={cx("min-w-0 flex-[1_1_0] rounded-[1px]", CELL[b.worst ?? "none"])}
        />
      ))}
    </span>
  );
}
