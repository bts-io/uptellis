import { highlightSlots, type Level, type SiteView } from "@/shared/view";
import { ago, clock, cx, day, ms } from "./format";

/**
 * The last four incidents as cards: resolved or open, title, when and how long. Under pressure on a wall
 * screen (`squeezed`: the alert rows or a short screen leave no room) the cards give way to one line with the
 * latest incident, so the service tiles keep their room; a phone always shows the cards.
 */
export function History({ view, squeezed }: { view: SiteView; squeezed: boolean }) {
  const recent = view.incidents.recent.slice(0, 4);
  const [last] = recent;
  const line = last
    ? `${last.endedAt ? "Resolved" : "Open"}: ${last.title} · ${day(last.startedAt)}, ${clock(last.startedAt)} · lasted ${ago(last.durationS)}${recent.length > 1 ? ` · +${recent.length - 1} more` : ""}`
    : "No incidents in the recent history.";
  return (
    <section
      aria-labelledby="g-history"
      data-g-history=""
      data-squeezed={squeezed ? "" : undefined}
      className="group/h flex flex-col gap-2"
    >
      <div className="flex min-w-0 items-baseline gap-4">
        <h2
          id="g-history"
          className="text-[1.1rem] font-bold tracking-[0.16em] whitespace-nowrap text-muted uppercase"
        >
          Recent incidents
        </h2>
        <p
          data-g-history-line=""
          title={line}
          className="hidden min-w-0 flex-1 truncate text-[1.2rem] text-muted min-[900px]:group-data-squeezed/h:block"
        >
          {line}
        </p>
      </div>
      <ol className="grid grid-cols-1 gap-3 min-[900px]:grid-cols-4 min-[900px]:group-data-squeezed/h:hidden">
        {recent.length ? (
          recent.map((i) => (
            <li
              key={i.id}
              className="flex min-w-0 flex-col gap-1 rounded-xl border-[0.12rem] border-line bg-panel px-[0.9rem] py-2.5"
            >
              <span
                className={cx(
                  "text-[0.95rem] font-bold tracking-[0.1em] uppercase",
                  i.endedAt ? "text-up" : "text-down",
                )}
              >
                {i.endedAt ? "Resolved" : "Open"}
              </span>
              <span className="text-[1.35rem] font-bold">{i.title}</span>
              <span className="text-[1.1rem] text-muted">
                {day(i.startedAt)}, {clock(i.startedAt)} · lasted {ago(i.durationS)}
              </span>
            </li>
          ))
        ) : (
          <li className="col-span-full text-[1.3rem] text-muted">No incidents in the recent history.</li>
        )}
      </ol>
    </section>
  );
}

const NOTE: Record<Level, string> = {
  ok: "text-up",
  warn: "text-degraded",
  crit: "text-down",
  info: "text-muted",
};

/**
 * The foot: the profile's headline, average latency and health, the profiles' highlights (with their
 * badge, e.g. "latest" or "2.6.0 available"), and the site's links.
 */
export function Foot({ view }: { view: SiteView }) {
  const s = view.summary;
  const bits = [
    view.headline,
    s.avgLatencyMs === null ? null : `avg latency ${ms(s.avgLatencyMs)}`,
    s.healthScore === null ? null : `health ${Math.round(s.healthScore)}/100`,
  ].filter(Boolean);
  const slots = highlightSlots(view.highlights);
  return (
    <footer className="flex flex-col gap-1.5 text-[1.1rem] text-muted">
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
        <p>{bits.join(" · ")}</p>
        {view.links.length > 0 && (
          <ul className="flex flex-wrap gap-5">
            {view.links.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="font-bold text-ink">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {slots.length > 0 && (
        <ul aria-label="Highlights" className="flex flex-wrap gap-x-5 gap-y-1">
          {slots.map((h) => (
            <li key={h.label} className="whitespace-nowrap">
              <span className="font-bold tracking-[0.1em] uppercase">{h.label}</span>{" "}
              <span className="text-ink">{h.texts.join(" · ")}</span>
              {h.note && (
                <span className={cx("ml-2 font-bold tracking-[0.06em] uppercase", NOTE[h.note.level])}>
                  {h.note.text}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </footer>
  );
}
