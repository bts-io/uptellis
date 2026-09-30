import type { SiteView } from "@/shared/view";
import { dur, hhmm, shortDay } from "./format";
import { Label, LiveAge } from "./ui";

/** Open incidents only when there are some: title, since when, how long, the last step and notes. */
export function Ongoing({ view }: { view: SiteView }) {
  const open = view.incidents.open;
  if (!open.length) return null;
  return (
    <section aria-labelledby="i-h-open" className="mt-12 max-[560px]:mt-[38px]">
      <Label id="i-h-open">Ongoing</Label>
      <ul className="m-0 list-none p-0">
        {open.map((i) => {
          const last = i.steps.at(-1);
          return (
            <li key={i.id} className="border-t border-line py-3 last:border-b">
              <div className="flex items-baseline gap-2.5 font-semibold text-(--i-down-text) before:size-2 before:flex-none before:-translate-y-px before:rounded-full before:bg-down before:content-['']">
                {i.title}
              </div>
              <p className="mt-0.5 mb-0 ml-[18px] text-[13.5px] text-muted">
                Since {hhmm(i.startedAt)}, <LiveAge seconds={i.durationS} now={view.now} suffix={false} />
                {last ? `. ${last.label}` : ""}
                {i.notes ? `. ${i.notes}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Past incidents as a quiet list: day, title, how long. */
export function Past({ view }: { view: SiteView }) {
  const recent = view.incidents.recent;
  return (
    <section aria-labelledby="i-h-past" className="mt-12 max-[560px]:mt-[38px]">
      <Label id="i-h-past">Past incidents</Label>
      {recent.length ? (
        <ul className="m-0 list-none p-0">
          {recent.map((i) => (
            <li key={i.id} className="flex gap-3.5 py-[5px] text-sm">
              <time
                dateTime={i.startedAt}
                className="w-[52px] flex-none text-faint tabular-nums max-[560px]:w-[46px]"
              >
                {shortDay(i.startedAt)}
              </time>
              <span className="min-w-0">
                <span className="underline decoration-[color-mix(in_srgb,currentColor_30%,transparent)] underline-offset-[3px]">
                  {i.title}
                </span>{" "}
                <span className="whitespace-nowrap text-faint">
                  {i.endedAt ? dur(i.durationS) : "ongoing"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-muted">No recent incidents.</p>
      )}
    </section>
  );
}
