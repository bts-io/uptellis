import type { ReactNode } from "react";
import { Age, Gauge, isIconName, KeyValueGrid, Panel, StateDot } from "@/client/kit";
import type { IconName } from "@/client/kit/props";
import { type DisplayState, highlightSlots, type Level, type SiteView } from "@/shared/view";
import { cx, DASH, healthLevel, hhmmss, isStale, LEVEL_TEXT, pct, uptimeLevel } from "./format";

/** A group's icon from its profile, else the grid. */
const groupIcon = (view: SiteView, group: string): IconName => {
  const icon = view.factGroups.find((g) => g.id === group)?.icon ?? null;
  return isIconName(icon) ? icon : "grid";
};

/** Only a warning or a failure colours a summary value. */
const levelText = (level: Level | null) =>
  level === "warn" || level === "crit" ? LEVEL_TEXT[level] : undefined;

/**
 * The `[ sys.status ]` key/value box: the monitor figures, then one cell per highlight slot of the active
 * profiles; three columns on desktop, one on phones.
 */
export function SummaryBox({ view }: { view: SiteView }) {
  const s = view.summary;
  const stale = isStale(view);
  // A legend dot keeps its colour only while the data is live.
  const dot = (state: DisplayState) => <StateDot state={stale ? "stale" : state} />;

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
    ...highlightSlots(view.highlights).map((slot) => ({
      icon: groupIcon(view, slot.rows[0].group),
      label: slot.label,
      value: (
        <>
          <span className={levelText(slot.rows[0].level)}>{slot.rows[0].display}</span>
          {slot.note && <span className={cx("text-xs", LEVEL_TEXT[slot.note.level])}>{slot.note.text}</span>}
          {slot.rows.slice(1).map((r) => (
            <span key={`${r.group}.${r.key}`} className="text-muted">
              {r.display}
            </span>
          ))}
        </>
      ),
    })),
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
