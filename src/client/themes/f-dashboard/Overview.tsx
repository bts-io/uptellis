import type { ReactNode } from "react";
import type { ServiceView, SiteView, SummaryView, VerdictState } from "@/shared/view";
import { cx, ms, pct, TONE_FILL, type Tone } from "./format";
import { Card, Eyebrow, Glyph, type GlyphName, SOFT, SOLID } from "./ui";

const VERDICT_TONE: Record<VerdictState, Tone> = {
  operational: "up",
  degraded: "degraded",
  outage: "down",
  maintenance: "maint",
  stale: "stale",
  empty: "stale",
};
const VERDICT_GLYPH: Record<VerdictState, GlyphName> = {
  operational: "check",
  degraded: "warn",
  outage: "x",
  maintenance: "wrench",
  stale: "clock",
  empty: "question",
};
const VERDICT_WORD: Record<VerdictState, string> = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
  maintenance: "Maintenance",
  stale: "Stale data",
  empty: "No data",
};
/** The verdict card's left rule. */
const RULE: Record<Tone, string> = {
  up: "before:bg-up",
  degraded: "before:bg-degraded",
  down: "before:bg-down",
  maint: "before:bg-maint",
  stale: "before:bg-stale",
};

/** The verdict card (donut, verdict, headline, legend) beside four KPI cards; stacked below 980px. */
export function Overview({ view, services }: { view: SiteView; services: ServiceView[] }) {
  const st = view.verdict.state;
  const tone = VERDICT_TONE[st];
  const s = view.summary;
  const parts = donutParts(s, st);
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 min-[981px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Card
        data-state={st}
        aria-labelledby="f-verdict-h"
        className={cx(
          "relative flex flex-col items-start gap-4 overflow-hidden before:absolute before:inset-y-0 before:left-0 before:w-[5px] sm:flex-row sm:items-center sm:gap-6",
          RULE[tone],
        )}
      >
        <Donut summary={s} state={st} parts={parts} />
        <div className="min-w-0 flex-1">
          <span
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full py-1 pr-2.5 pl-1.5 text-xs font-bold tracking-[0.05em] uppercase",
              SOFT[tone],
            )}
          >
            <span className={cx("grid size-[18px] place-items-center rounded-full", SOLID[tone])}>
              <Glyph name={VERDICT_GLYPH[st]} size={11} />
            </span>
            {VERDICT_WORD[st]}
          </span>
          <h2
            id="f-verdict-h"
            className="m-0 mt-2.5 mb-1.5 text-[22px] leading-[1.15] font-extrabold tracking-[-0.02em] sm:text-[26px]"
          >
            {view.verdict.label}
          </h2>
          {view.headline && <p className="m-0 text-sm text-(--f-text-2)">{view.headline}</p>}
          <ul className="m-0 mt-3.5 grid list-none grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-x-3.5 gap-y-1.5 p-0">
            {parts.map((p) => (
              <li key={p.key} className="flex items-center gap-2 text-[13px] text-(--f-text-2)">
                <span
                  className="size-2.5 flex-none rounded-[3px]"
                  style={{ background: TONE_FILL[p.tone] }}
                />
                {p.label}
                <b className="ml-auto font-bold text-ink tabular-nums">{p.n}</b>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Kpi label="Avg latency" aria="Average latency" glyph="pulse" foot="Latest check, per service">
          <Value unit={s.avgLatencyMs === null ? undefined : "ms"}>{ms(s.avgLatencyMs)}</Value>
          <LatencyBars services={services} />
        </Kpi>
        <Kpi label="Uptime 24h" aria="Uptime, last 24 hours" glyph="uptime" foot="Mean across services">
          <Value>{pct(s.uptime24h)}</Value>
          <Meter value={s.uptime24h === null ? 0 : s.uptime24h * 100} />
        </Kpi>
        <Kpi label="Uptime 30d" aria="Uptime, last 30 days" glyph="uptime" foot="Mean across services">
          <Value>{pct(s.uptime30d)}</Value>
          <Meter value={s.uptime30d === null ? 0 : s.uptime30d * 100} />
        </Kpi>
        <Kpi label="Health score" aria="Health score" glyph="heart" foot="Uptime, latency and certificates">
          <Value unit={s.healthScore === null ? undefined : "/100"}>
            {s.healthScore === null ? "n/a" : s.healthScore.toFixed(1)}
          </Value>
          <Meter value={s.healthScore ?? 0} />
        </Kpi>
      </div>
    </div>
  );
}

interface DonutPart {
  key: string;
  n: number;
  label: string;
  tone: Tone;
}

function donutParts(s: SummaryView, state: VerdictState): DonutPart[] {
  return [
    { key: "up", n: s.up, label: "Operational", tone: "up" },
    { key: "degraded", n: s.degraded, label: "Degraded", tone: "degraded" },
    { key: "down", n: s.down, label: "Down", tone: "down" },
    { key: "maintenance", n: s.maintenance, label: "Maintenance", tone: "maint" },
    { key: "other", n: s.other, label: state === "stale" ? "Stale" : "Other", tone: "stale" },
  ];
}

const R = 50;
const C = 2 * Math.PI * R;

/** Services by state as a ring, 3px gaps between segments; the centre reads `8/8 services up`. */
function Donut({ summary, state, parts }: { summary: SummaryView; state: VerdictState; parts: DonutPart[] }) {
  const total = summary.total;
  const shown = parts.filter((p) => p.n > 0);
  const gap = shown.length > 1 ? 3 : 0;
  let off = 0;
  const segs = shown.map((p) => {
    const len = (p.n / total) * C;
    const seg = { key: p.key, tone: p.tone, dash: Math.max(0, len - gap), offset: -off };
    off += len;
    return seg;
  });
  const [big, small] =
    state === "stale"
      ? [`${summary.other}/${total}`, "not current"]
      : state === "empty"
        ? ["0", "services"]
        : state === "maintenance"
          ? [`${summary.maintenance}/${total}`, "in maintenance"]
          : [`${summary.up}/${total}`, "services up"];
  const desc = shown.map((p) => `${p.n} ${p.label.toLowerCase()}`).join(", ") || "none";
  return (
    <div
      role="img"
      aria-label={`${total} services: ${desc}`}
      className="relative size-32 flex-none sm:size-[148px]"
    >
      <svg viewBox="0 0 128 128" aria-hidden="true" className="size-full -rotate-90">
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--color-hair)" strokeWidth="14" />
        {segs.map((g) => (
          <circle
            key={g.key}
            data-seg={g.key}
            cx="64"
            cy="64"
            r={R}
            fill="none"
            stroke={TONE_FILL[g.tone]}
            strokeWidth="14"
            strokeDasharray={`${g.dash.toFixed(2)} ${C.toFixed(2)}`}
            strokeDashoffset={g.offset.toFixed(2)}
          />
        ))}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">
        <strong className="text-[32px] leading-none font-extrabold tracking-[-0.02em] tabular-nums">
          {big}
        </strong>
        <span className="mt-1 text-xs font-semibold text-muted">{small}</span>
      </div>
    </div>
  );
}

function Kpi({
  label,
  aria,
  glyph,
  foot,
  children,
}: {
  label: string;
  aria: string;
  glyph: GlyphName;
  foot: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={aria}
      className="flex min-w-0 flex-col gap-2 rounded-[18px] border border-line bg-panel p-3.5 shadow-(--f-shadow) sm:px-5 sm:py-[18px]"
    >
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>{label}</Eyebrow>
        <span className="grid size-[30px] flex-none place-items-center rounded-[9px] bg-(--f-accent-soft) text-accent">
          <Glyph name={glyph} size={16} />
        </span>
      </div>
      {children}
      <p className="m-0 text-[12.5px] text-muted">{foot}</p>
    </section>
  );
}

function Value({ unit, children }: { unit?: string; children: ReactNode }) {
  return (
    <p className="m-0 text-[22px] leading-[1.1] font-extrabold tracking-[-0.02em] whitespace-nowrap tabular-nums sm:text-[28px]">
      {children}
      {unit && <small className="ml-0.5 text-[15px] font-semibold tracking-normal text-muted">{unit}</small>}
    </p>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-hair">
      <span
        className="block h-full rounded-[inherit] bg-[linear-gradient(90deg,var(--color-accent),var(--f-teal))]"
        style={{ width: `${Math.min(100, Math.max(0, value)).toFixed(2)}%` }}
      />
    </div>
  );
}

/** Each service's latest latency as a small bar; a service without one reads as a short red bar. */
function LatencyBars({ services }: { services: ServiceView[] }) {
  const W = 200;
  const H = 34;
  const max = Math.max(1, ...services.map((s) => s.latencyMs ?? 0));
  const bw = W / Math.max(1, services.length);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="block h-[34px] w-full"
    >
      {services.map((s, i) => {
        // No latency: a full-strength down bar only for a down service; otherwise (maintenance, paused) faint.
        const silent = s.latencyMs === null;
        const failed = silent && s.state === "down";
        const h = silent ? 3 : Math.max(3, (s.latencyMs! / max) * H);
        return (
          <rect
            key={s.id}
            x={(i * bw + 2).toFixed(1)}
            y={(H - h).toFixed(1)}
            width={Math.max(2, bw - 4).toFixed(1)}
            height={h.toFixed(1)}
            rx="2"
            fill={failed ? "var(--color-down)" : silent ? "var(--color-faint)" : "var(--color-accent)"}
            fillOpacity={failed ? 1 : 0.75}
          >
            <title>{`${s.name}: ${failed ? "no response" : silent ? "no latency" : `${s.latencyMs} ms`}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
