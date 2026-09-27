import type { ReactNode } from "react";
import { Gauge, Sparkline, StateDot } from "@/client/kit";
import type { ServiceView, SiteView } from "@/shared/view";
import { Block, DataAge, kumaSeenAt } from "./Block";
import {
  checkType,
  cx,
  DASH,
  failing,
  healthLevel,
  hhmmss,
  isStale,
  LEVEL_TEXT,
  monthDay,
  pct,
  STATE_TEXT,
  slug,
} from "./format";

/** One monitor in full: check, TLS, uptime and health, its latency over the recent checks, the last five checks. */
export function InspectBlock({ view, service: s }: { view: SiteView; service: ServiceView }) {
  const stale = isStale(view);
  const lat = s.spark;
  const lo = lat.length ? Math.min(...lat) : null;
  const hi = lat.length ? Math.max(...lat) : null;
  const avg = s.avgLatencyMs ?? (lat.length ? lat.reduce((a, b) => a + b, 0) / lat.length : null);
  const ms = (v: number | null) => (v === null ? DASH : String(Math.round(v)));

  return (
    <Block
      id="inspect"
      title={`Inspect: ${s.name}`}
      command={`monitors --inspect ${slug(s.name)}`}
      aside={<DataAge view={view} since={kumaSeenAt(view)} stale={stale} />}
      exitCode={failing(s) ? 1 : 0}
      stale={stale}
    >
      <p className="m-0 mb-3.5 flex items-baseline gap-3 font-sans text-[17px] leading-[1.35] font-medium tracking-[-0.01em] [&>[role=img]]:-top-0.5 [&>[role=img]]:size-2.5">
        <StateDot state={s.state} />
        <span className="min-w-0">
          {s.name}{" "}
          <span className="font-mono text-[13px] text-muted">
            {checkType(s)}
            {s.targetDisplay && ` · ${s.targetDisplay}`}
          </span>
        </span>
      </p>

      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-hair min-[721px]:grid-cols-2 min-[981px]:grid-cols-[1.1fr_1fr_1fr]">
        <Section title="check">
          <Row label="type">{checkType(s)}</Row>
          <Row label="target">{s.targetDisplay ?? DASH}</Row>
          <Row label="interval / timeout">
            {s.intervalS === null ? DASH : `${s.intervalS}s`} /{" "}
            {s.timeoutS === null ? DASH : `${s.timeoutS}s`}
          </Row>
          <Row label="avg response">{avg === null ? DASH : `${Math.round(avg)} ms`}</Row>
        </Section>
        <Section title="tls">
          {s.cert ? (
            <>
              <Row label="common name">{s.cert.cn ?? DASH}</Row>
              <Row label="issuer">{s.cert.issuer ?? DASH}</Row>
              <Row label="expires">
                {s.cert.validTo ? monthDay(s.cert.validTo) : DASH}
                {s.cert.daysRemaining !== null && (
                  <>
                    {" · "}
                    <span className={LEVEL_TEXT[s.cert.level]}>{s.cert.daysRemaining}d left</span>
                  </>
                )}
              </Row>
              <Row label="validity">
                <Gauge
                  value={
                    s.cert.daysRemaining === null ? null : Math.min(100, (s.cert.daysRemaining / 90) * 100)
                  }
                  cells={14}
                  level={s.cert.level}
                  label="certificate validity left"
                />
              </Row>
            </>
          ) : (
            <Row label="tls">
              <span className="text-muted">n/a · {checkType(s)} check</span>
            </Row>
          )}
        </Section>
        <Section title="uptime + health" wide>
          <Row label="uptime 24h">{s.uptime24h === null ? DASH : `${pct(s.uptime24h)}%`}</Row>
          <Row label="uptime 30d">{s.uptime30d === null ? DASH : `${pct(s.uptime30d)}%`}</Row>
          <Row label={s.health.score === null ? "health" : `health ${s.health.score.toFixed(1)}`}>
            <Gauge
              value={s.health.score}
              cells={14}
              level={s.health.score === null ? undefined : healthLevel(s.health.score)}
              label="health score"
            />
          </Row>
          <Row label="points lost">
            <span className={cx(!s.health.reasons.length && "text-up")}>
              {s.health.reasons.length ? s.health.reasons.join(", ") : "none"}
            </span>
          </Row>
        </Section>
      </div>

      <figure className="m-0 mt-3.5 rounded-lg border border-hair px-4 pt-3 pb-2">
        <figcaption className="mb-2 flex flex-wrap justify-between gap-3 font-mono text-[11.5px] leading-none text-muted">
          <span>response time · last {s.recent.length} checks</span>
          <span>
            min {ms(lo)} · avg {ms(avg)} · max {ms(hi)} ms
          </span>
        </figcaption>
        <Sparkline
          points={lat}
          width={1000}
          height={70}
          level={s.state === "down" ? "crit" : "ok"}
          label={lat.length ? `latency ${lo} to ${hi} ms` : "no latency reported"}
        />
      </figure>

      {s.recent.length > 0 && (
        <ol className="m-0 mt-3.5 grid list-none grid-cols-2 gap-2 p-0 min-[721px]:grid-cols-3 min-[981px]:grid-cols-5">
          {s.recent.slice(0, 5).map((b, i) => (
            <li
              key={b.ts}
              data-state={b.status}
              className={cx(
                "min-w-0 rounded-md border px-2.5 py-2 font-mono text-xs leading-[1.45]",
                b.status === "down" ? "border-down/35 bg-down/6" : "border-hair",
                i === 4 && "max-[720px]:hidden",
              )}
            >
              <time dateTime={b.ts} className="block text-[11px] text-muted">
                {hhmmss(b.ts)}
              </time>
              <div className={cx("uppercase", STATE_TEXT[b.status])}>{b.status}</div>
              <div className="truncate text-muted">{b.message ?? DASH}</div>
              <div>{b.latencyMs === null ? DASH : `${b.latencyMs} ms`}</div>
            </li>
          ))}
        </ol>
      )}
    </Block>
  );
}

function Section({ title, wide = false, children }: { title: string; wide?: boolean; children: ReactNode }) {
  return (
    <section
      className={cx(
        "min-w-0 border-hair px-[18px] py-3.5 max-[720px]:border-b max-[720px]:last:border-b-0 min-[721px]:border-r min-[721px]:last:border-r-0",
        wide && "min-[721px]:max-[980px]:col-span-2 min-[721px]:max-[980px]:border-t",
      )}
    >
      <h3 className="m-0 mb-2.5 font-mono text-[11px] leading-none font-medium tracking-[0.08em] text-muted uppercase">
        {title}
      </h3>
      <dl className="m-0">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3.5 text-[12.5px] leading-[1.85]">
      <dt className="shrink-0 font-sans text-muted">{label}</dt>
      <dd className="m-0 flex min-w-0 items-center justify-end truncate text-right font-mono">{children}</dd>
    </div>
  );
}
