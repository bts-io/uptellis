import type { SiteView } from "@/shared/view";
import { allServices, cx, monthName } from "./format";
import { Chip, Micro, Tile, TileHead } from "./ui";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

type Mark = { level: "down" | "degraded"; services: Set<string> };

/**
 * This month as a calendar with the days any monitor had an outage (red) or was degraded (amber) circled,
 * from the services' daily beats and the open incidents; the title of a day lists the services.
 */
export function IncidentCalendar({ view, className }: { view: SiteView; className?: string }) {
  const today = view.now.slice(0, 10);
  const month = today.slice(0, 7);
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const prevDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();

  const marks = new Map<number, Mark>();
  const mark = (day: string, level: Mark["level"], service: string) => {
    if (!day.startsWith(month)) return;
    const d = Number(day.slice(8, 10));
    const cur = marks.get(d) ?? { level, services: new Set<string>() };
    if (level === "down") cur.level = "down";
    cur.services.add(service);
    marks.set(d, cur);
  };
  for (const s of allServices(view))
    for (const b of s.beats90d) {
      if (b.worst === "down") mark(b.day, "down", s.name);
      else if (b.worst === "degraded" || b.worst === "pending") mark(b.day, "degraded", s.name);
    }
  for (const i of view.incidents.open) mark(i.startedAt, "down", i.subject);

  return (
    <Tile aria-label="Incident calendar" className={className}>
      <TileHead>
        <Micro>Incidents</Micro>
        <Chip className="text-ink">
          {monthName(today)} {y}
        </Chip>
      </TileHead>
      <div className="px-4 pt-3 pb-3">
        <div className="grid grid-cols-7 gap-1 text-center font-mono">
          {WEEKDAYS.map((d) => (
            <div key={d} className="pb-0.5 text-[10px] tracking-[.06em] text-faint">
              {d}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div
              key={`out-${i}`}
              className="mx-auto flex size-7 items-center justify-center text-[11.5px] text-(--b-cal-out)"
            >
              {prevDays - lead + i + 1}
            </div>
          ))}
          {Array.from({ length: days }, (_, i) => {
            const d = i + 1;
            const e = marks.get(d);
            const isToday = `${month}-${String(d).padStart(2, "0")}` === today;
            return (
              <div
                key={d}
                title={e ? `${monthName(today)} ${d}: ${[...e.services].join(", ")}` : undefined}
                data-mark={e?.level}
                className={cx(
                  "mx-auto flex size-7 items-center justify-center rounded-full text-[11.5px]",
                  e?.level === "down"
                    ? "cursor-help bg-down/12 text-ink shadow-[inset_0_0_0_1.5px_var(--color-down)]"
                    : e?.level === "degraded"
                      ? "cursor-help bg-degraded/10 text-ink shadow-[inset_0_0_0_1.5px_var(--color-degraded)]"
                      : isToday
                        ? "text-ink shadow-[inset_0_0_0_1px_var(--b-hair3)]"
                        : "text-muted",
                )}
              >
                {d}
              </div>
            );
          })}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
          <span>{marks.size} days with events</span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block size-2 rounded-full shadow-[inset_0_0_0_1.5px_var(--color-down)]" />
            outage
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block size-2 rounded-full shadow-[inset_0_0_0_1.5px_var(--color-degraded)]" />
            degraded
          </span>
        </div>
      </div>
    </Tile>
  );
}
