import type { ReactNode } from "react";
import { Age, Gauge, isIconName, KeyValueGrid, Panel, StateDot } from "@/client/kit";
import type { IconName } from "@/client/kit/props";
import {
  type DisplayState,
  type HighlightSlot,
  highlightSlots,
  type Level,
  type SiteView,
  SUMMARY_SLOTS,
} from "@/shared/view";
import { cx, DASH, healthLevel, hhmmss, isStale, LEVEL_STATE, LEVEL_TEXT, pct, uptimeLevel } from "./format";

/** A group's icon from its profile, else the grid. */
const groupIcon = (view: SiteView, group: string): IconName => {
  const icon = view.factGroups.find((g) => g.id === group)?.icon ?? null;
  return isIconName(icon) ? icon : "grid";
};

/** Only a warning or a failure colours a summary value. */
const levelText = (level: Level | null) =>
  level === "warn" || level === "crit" ? LEVEL_TEXT[level] : undefined;

/**
 * The `[ sys.status ]` key/value box: the monitor figures and one cell per highlight slot of the active
 * profiles, all in slot order (`SUMMARY_SLOTS` for the figures); three columns on desktop, one on phones.
 */
export function SummaryBox({ view }: { view: SiteView }) {
  const s = view.summary;
  const stale = isStale(view);
  // A legend dot keeps its colour only while the data is live.
  const dot = (state: DisplayState) => <StateDot state={stale ? "stale" : state} />;

  const figures: { slot: number; icon: IconName; label: string; value: ReactNode }[] = [
    {
      slot: SUMMARY_SLOTS.monitors,
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
      slot: SUMMARY_SLOTS.avgLatency,
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
      slot: SUMMARY_SLOTS.health,
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
      slot: SUMMARY_SLOTS.uptime24h,
      icon: "up",
      label: "uptime 24h",
      value: <UptimeMeter ratio={s.uptime24h} label="uptime 24 hours" />,
    },
    {
      slot: SUMMARY_SLOTS.uptime30d,
      icon: "clock",
      label: "uptime 30d",
      value: <UptimeMeter ratio={s.uptime30d} label="uptime 30 days" />,
    },
    {
      slot: SUMMARY_SLOTS.snapshot,
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
      slot: slot.slot ?? Number.POSITIVE_INFINITY,
      icon: groupIcon(view, slot.rows[0].group),
      label: slot.label,
      value: <SlotValue slot={slot} stale={stale} />,
    })),
  ];
  // Stable: highlights without a slot keep their order after the rest.
  const items = figures.sort((a, b) => a.slot - b.slot);

  return (
    <Panel title="sys.status" exitCode={s.down > 0 ? 1 : 0} className={cx(stale && "border-dashed")}>
      <KeyValueGrid items={items} columns={3} />
    </Panel>
  );
}

/**
 * A highlight slot: the value, its badge, then the details (after a separator when a badge sits between
 * them), `2.5.5 latest · db 41.2 MB`. A lone value with a level and no badge reads as a status and takes
 * its dot: `● reachable (HTTP 200)`.
 */
function SlotValue({ slot, stale }: { slot: HighlightSlot; stale: boolean }) {
  const [row] = slot.rows;
  const details = slot.texts.slice(1);
  const status = row.level !== null && row.level !== "info" && !slot.note && !details.length;
  return (
    <>
      {status && row.level ? (
        <Inline>
          <StateDot state={stale ? "stale" : LEVEL_STATE[row.level]} />
          <span className={levelText(row.level)}>{slot.texts[0]}</span>
        </Inline>
      ) : (
        <span>{slot.texts[0]}</span>
      )}
      {slot.note && <span className={cx("text-xs", LEVEL_TEXT[slot.note.level])}>{slot.note.text}</span>}
      {slot.note && details.length > 0 && <Sep />}
      {details.map((text) => (
        <span key={text} className="text-muted">
          {text}
        </span>
      ))}
    </>
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
