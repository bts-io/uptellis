import type { ReactNode } from "react";
import { Age, Gauge, KeyValueGrid, Panel, StateDot } from "@/client/kit";
import type { IconName } from "@/client/kit/props";
import type { DisplayState, Level, SiteView } from "@/shared/view";
import { isNewer } from "@/shared/view";
import {
  cx,
  DASH,
  fact,
  factText,
  healthLevel,
  hhmmss,
  isStale,
  LEVEL_TEXT,
  pct,
  uptimeLevel,
} from "./format";

/** The `[ sys.status ]` key/value box: 3x3 on desktop, one column on phones. */
export function SummaryBox({ view }: { view: SiteView }) {
  const s = view.summary;
  const stale = isStale(view);
  // A legend dot keeps its colour only while the data is live.
  const dot = (state: DisplayState) => <StateDot state={stale ? "stale" : state} />;
  const latest = fact(view, "kuma.latestVersion");
  const version = factText(view, "kuma.version");
  const reachable = fact(view, "watchdog.reachable");

  const items: { icon: IconName; label: string; value: ReactNode }[] = [
    {
      icon: "grid",
      label: "monitors",
      value: (
        <>
          <span>{s.total} total</span>
          <Sep />
          <Inline>
            {dot("up")}
            {s.up} up
          </Inline>
          <Inline>
            {dot("down")}
            {s.down} down
          </Inline>
          {(s.maintenance > 0 || s.other === 0) && (
            <Inline>
              {dot("maintenance")}
              {s.maintenance} maint
            </Inline>
          )}
          {s.other > 0 && (
            <Inline>
              {dot("unknown")}
              {s.other} {stale ? "stale" : "other"}
            </Inline>
          )}
        </>
      ),
    },
    {
      icon: "bolt",
      label: "avg resp",
      value: (
        <>
          <span>{s.avgLatencyMs === null ? DASH : `${Math.round(s.avgLatencyMs)} ms`}</span>
          <span className="text-muted">across {s.total} checks</span>
        </>
      ),
    },
    {
      icon: "box",
      label: "kuma",
      value: (
        <>
          <span>{version}</span>
          {latest &&
            (!isNewer(latest.display, version) ? (
              <span className="text-xs text-up">latest</span>
            ) : (
              <span className="text-xs text-degraded">{latest.display} available</span>
            ))}
          <Sep />
          <span className="text-muted">db {factText(view, "kuma.dbSize")}</span>
        </>
      ),
    },
    {
      icon: "heart",
      label: "health",
      value: (
        <Meter
          value={s.healthScore}
          level={s.healthScore === null ? null : healthLevel(s.healthScore)}
          text={s.healthScore?.toFixed(1)}
          label="health score"
        />
      ),
    },
    {
      icon: "up",
      label: "uptime 24h",
      value: <UptimeMeter ratio={s.uptime24h} label="uptime 24 hours" />,
    },
    {
      icon: "clock",
      label: "uptime 30d",
      value: <UptimeMeter ratio={s.uptime30d} label="uptime 30 days" />,
    },
    {
      icon: "host",
      label: "collector",
      value: (
        <>
          <span>{factText(view, "kuma.host")}</span>
          <span className="text-muted">{factText(view, "kuma.timezone")}</span>
        </>
      ),
    },
    {
      icon: "camera",
      label: "snapshot",
      value: (
        <>
          <span>{hhmmss(view.generatedAt)} UTC</span>
          <span className="text-muted">
            <Age since={view.generatedAt} now={view.now} />
          </span>
        </>
      ),
    },
    {
      icon: "eye",
      label: "watchdog",
      value: reachable ? (
        <Inline>
          {dot(reachable.level === "crit" ? "down" : "up")}
          <span>{reachable.display}</span>
        </Inline>
      ) : (
        <span className="text-muted">{DASH}</span>
      ),
    },
  ];

  return (
    <Panel title="sys.status" exitCode={s.down > 0 ? 1 : 0} className={cx(stale && "border-dashed")}>
      <KeyValueGrid items={items} columns={3} />
    </Panel>
  );
}

function Sep() {
  return <span className="text-faint">·</span>;
}

function Inline({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 whitespace-nowrap">{children}</span>;
}

function Meter({
  value,
  level,
  text,
  label,
}: {
  value: number | null;
  level: Level | null;
  text?: string;
  label: string;
}) {
  if (value === null) return <span className="text-muted">{DASH}</span>;
  return (
    <>
      <Gauge value={value} cells={18} level={level ?? undefined} label={label} />
      <span className={level ? LEVEL_TEXT[level] : undefined}>{text}</span>
    </>
  );
}

function UptimeMeter({ ratio, label }: { ratio: number | null; label: string }) {
  if (ratio === null) return <span className="text-muted">{DASH}</span>;
  return <Meter value={ratio * 100} level={uptimeLevel(ratio)} text={`${pct(ratio)}%`} label={label} />;
}
