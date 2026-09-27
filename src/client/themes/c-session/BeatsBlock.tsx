import { StateDot } from "@/client/kit";
import type { SiteView } from "@/shared/view";
import { Block, DataAge, kumaSeenAt } from "./Block";
import { allServices, cx, isStale, monthDay, pct } from "./format";

/** Colour per `+~x=.` tick (the beatsText alphabet). */
const TICK: Record<string, string> = {
  "+": "text-up opacity-55",
  "~": "font-bold text-degraded",
  x: "font-bold text-down",
  "=": "text-maint",
  ".": "text-faint",
};

const LEGEND = [
  { char: "+", label: "operational", className: "text-up" },
  { char: "~", label: "degraded", className: "text-degraded" },
  { char: "x", label: "outage", className: "text-down" },
  { char: "=", label: "maintenance", className: "text-maint" },
  { char: ".", label: "no data", className: "text-faint" },
];

/** Phones show the newest half of the 90 ticks. */
const PHONE_TICKS = 45;

/** Runs of equal ticks, so a 90-day row is a handful of spans; `old` marks ticks hidden on phones. */
function runs(text: string) {
  const out: { char: string; text: string; old: boolean }[] = [];
  const cut = text.length - PHONE_TICKS;
  [...text].forEach((char, i) => {
    const old = i < cut;
    const last = out.at(-1);
    if (last && last.char === char && last.old === old) last.text += char;
    else out.push({ char, text: char, old });
  });
  return out;
}

/** One `+~x=.` tick per day for 90 days per monitor: copyable text, worst state of the day wins. */
export function BeatsBlock({ view }: { view: SiteView }) {
  const stale = isStale(view);
  const services = allServices(view);
  const days = services[0]?.beats90d ?? [];
  const today = (text: string) => text.at(-1);

  return (
    <Block
      id="beats"
      title="Beats 90d"
      command="monitors --beats 90d"
      aside={<DataAge view={view} since={kumaSeenAt(view)} stale={stale} />}
      exitCode={services.some((s) => today(s.beatsText) === "x") ? 1 : 0}
      stale={stale}
    >
      <div className="grid grid-flow-row-dense grid-cols-[minmax(0,1fr)_auto] items-center md:grid-flow-row md:grid-cols-[210px_max-content_minmax(0,1fr)] md:gap-x-[18px]">
        {services.map((s) => (
          <div key={s.id} className="contents">
            <div className="flex items-center gap-2.5 py-[5px] font-mono text-[13px] leading-[1.3] font-medium whitespace-nowrap">
              <StateDot state={s.state} />
              {s.name}
            </div>
            <div
              role="img"
              aria-label={`${s.name} 90 days: ${s.beatsText}`}
              data-copy={s.beatsText}
              className="col-span-full overflow-hidden font-mono text-xs leading-[1.3] font-medium whitespace-pre md:col-span-1 md:py-[5px] md:text-[13px] md:tracking-[0.5px]"
            >
              {runs(s.beatsText).map((r, i) => (
                <span key={i} className={cx(TICK[r.char], r.old && "max-md:hidden")}>
                  {r.text}
                </span>
              ))}
            </div>
            <div className="py-[5px] text-right font-mono text-[13px] leading-[1.3] whitespace-nowrap max-md:col-start-2">
              {pct(s.uptime30d)}
              <small className="text-muted">% 30d</small>
            </div>
          </div>
        ))}
      </div>
      <p className="m-0 mt-3.5 flex flex-wrap gap-x-[18px] gap-y-2 font-mono text-xs leading-none text-muted">
        {LEGEND.map((l) => (
          <span key={l.char}>
            <b className={cx("mr-1.5 font-bold", l.className)}>{l.char}</b>
            {l.label}
          </span>
        ))}
        {days.length > 0 && (
          <span className="text-faint">
            one tick per day, worst state wins · {monthDay(days[0]!.day)} to {monthDay(days.at(-1)!.day)}
          </span>
        )}
      </p>
    </Block>
  );
}
