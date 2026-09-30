import type { IncidentView } from "@/shared/view";
import { clock, cx, newsBody, shortDate } from "./format";

/** Incidents as news items: the date in the margin, a headline tagged Ongoing or Resolved, one paragraph. */
export function NewsList({ incidents, open }: { incidents: IncidentView[]; open: boolean }) {
  return (
    <ul className="m-0 list-none p-0">
      {incidents.map((i) => (
        <li
          key={i.id}
          data-incident={open ? "open" : "resolved"}
          className={cx(
            "grid grid-cols-[7.5rem_1fr] gap-x-6 gap-y-1 border-b border-(--e-rule) py-5 max-[640px]:grid-cols-1",
            open && "border-l-[3px] border-l-down pl-4",
          )}
        >
          <div className="pt-[0.35rem] font-sans text-[0.8rem] leading-[1.4] text-muted">
            <strong className="block font-semibold text-ink max-[640px]:mr-[0.4rem] max-[640px]:inline">
              {shortDate(i.startedAt)}
            </strong>
            {clock(i.startedAt)}
          </div>
          <div className="min-w-0">
            <h3 className="m-0 mb-[0.35rem] font-(family-name:--e-serif-display) text-[1.35rem] leading-[1.2] font-semibold tracking-[-0.01em]">
              <span
                className={cx(
                  "mr-[0.4rem] font-sans text-[0.72rem] font-semibold tracking-[0.1em] uppercase",
                  open ? "text-down" : "text-up",
                )}
              >
                {open ? "Ongoing" : "Resolved"}
              </span>
              {i.title}
            </h3>
            <p className="m-0 text-(--e-ink-2)">{newsBody(i, open)}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
