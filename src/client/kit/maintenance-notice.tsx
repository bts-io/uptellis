import { utcHm } from "./format";
import type { MaintenanceNoticeProps } from "./props";

/**
 * One line per active maintenance window (title and when it ends, UTC); renders nothing when none is
 * active. A notice, not an alert: nothing is wrong, the covered services show `maintenance`.
 */
export function MaintenanceNotice({ windows, now }: MaintenanceNoticeProps) {
  if (!windows?.length) return null;
  const today = now.slice(0, 10);
  return (
    <div
      role="status"
      data-maintenance=""
      className="flex flex-col gap-1 border border-maint/55 bg-maint/12 px-4 py-2.5 font-mono text-xs font-semibold text-maint md:text-[12.5px]"
    >
      {windows.map((w) => (
        <span key={w.id}>
          MAINTENANCE: {w.title}, until {w.end.slice(0, 10) === today ? "" : `${w.end.slice(0, 10)} `}
          {utcHm(w.end)} UTC
        </span>
      ))}
    </div>
  );
}
