import { BeatBar, SummaryParts } from "@/client/kit";
import type { DisplayState, FactGroupView, ServiceView } from "@/shared/view";
import { cx, ms, pct, WORD } from "./format";
import { BoardIcon, stateIcon } from "./icons";

/** Per state: the tile's surface and edges, and `--g-c`, the colour of its top rule and state word. */
export const TILE: Record<DisplayState, string> = {
  up: "[--g-c:var(--color-up)]",
  degraded: "[--g-c:var(--color-degraded)] bg-(--g-degraded-bg)",
  pending: "[--g-c:var(--color-degraded)] bg-(--g-degraded-bg)",
  down: "[--g-c:var(--g-on-down)] border-(--g-down-edge) bg-(--g-down-fill)",
  maintenance: "[--g-c:var(--color-maint)] bg-(--g-maint-bg)",
  stale: "[--g-c:var(--color-stale)] border-dashed [border-top-style:solid]!",
  paused: "[--g-c:var(--g-unknown)]",
  unknown: "[--g-c:var(--g-unknown)]",
};

const TILE_BOX =
  "flex min-w-0 flex-col gap-2 rounded-[0.9rem] border-[0.15rem] border-t-[0.55rem] border-line border-t-(--g-c) bg-panel px-[1.1rem] pt-4 pb-[0.9rem]";

/**
 * Name and the state as icon plus word, in the state's colour. On a wall screen the name keeps to one line
 * and ends in an ellipsis (the full name in its title), so a long name never wraps into a clipped second line;
 * on a phone the tile is wide and the name wraps.
 */
function Head({
  name,
  state,
  word,
  muted,
}: {
  name: string;
  state: DisplayState;
  word: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2.5">
      <h3
        title={name}
        className={cx(
          "min-w-0 text-[1.6rem] leading-[1.05] font-bold [overflow-wrap:anywhere] min-[900px]:truncate min-[900px]:text-[1.9rem] min-[900px]:leading-[1.15]",
          muted && "text-muted",
        )}
      >
        {name}
      </h3>
      <span className="inline-flex items-center gap-1.5 text-[1.3rem] font-extrabold tracking-[0.04em] whitespace-nowrap text-(--g-c) uppercase min-[900px]:text-[1.6rem]">
        <BoardIcon name={stateIcon(state)} className="size-[1.6rem]" />
        {word}
      </span>
    </div>
  );
}

/**
 * One service: name and state word, its latency (or "No response" while down) and 30-day uptime, and the
 * 90-day strip. Each figure keeps its label on its own line (no "99.85%" split from "30 d"); when the row is
 * too narrow the figures wrap whole.
 */
export function ServiceTile({ service: s }: { service: ServiceView }) {
  const down = s.state === "down";
  const uptime = pct(s.uptime30d);
  const latency = ms(s.latencyMs);
  return (
    <li id={`svc-${s.id}`} data-state={s.state} className={cx(TILE_BOX, TILE[s.state])}>
      <Head name={s.name} state={s.state} word={WORD[s.state]} muted={s.state === "stale"} />
      <p
        className={cx(
          "flex flex-wrap gap-x-[1.1rem] gap-y-0.5 text-[1.2rem] font-semibold",
          down ? "text-(--g-down-ink) [&_b]:text-(--g-on-down)" : "text-muted [&_b]:text-ink",
        )}
      >
        {down ? <Figure value="No response" /> : latency && <Figure value={latency} />}
        {uptime && <Figure value={uptime} label="30 d" />}
        <Figure value="90" label="days" />
      </p>
      <Beats days={s.beats90d} text={s.beatsText} />
    </li>
  );
}

/** A bold figure and its small label, never broken apart. */
function Figure({ value, label }: { value: string; label?: string }) {
  return (
    <span data-figure="" className="whitespace-nowrap">
      <b className="font-bold">{value}</b>
      {label && ` ${label}`}
    </span>
  );
}

/** The kit's 90-day bar in a dark well; good days sit lower so the bad ones stand out, as on the mock-up. */
function Beats({ days, text }: { days: ServiceView["beats90d"]; text: string }) {
  return (
    <div className="rounded-md bg-(--g-well) p-1">
      <BeatBar
        days={days}
        text={text}
        height={18}
        className="[&_[data-worst=none]]:h-[70%] [&_[data-worst=none]]:self-end [&_[data-worst=up]]:h-[70%] [&_[data-worst=up]]:self-end"
      />
    </div>
  );
}

const LEVEL_WORD: Record<DisplayState, string> = { ...WORD, up: "OK", degraded: "Warning", down: "Failing" };

/** One fact group: title and level word, then its summary line, or its rows when it has no summary. */
export function FactTile({ group, state }: { group: FactGroupView; state: DisplayState }) {
  const stale = state === "stale";
  return (
    <li data-group={group.id} data-state={state} className={cx(TILE_BOX, TILE[state])}>
      <Head name={group.title} state={state} word={LEVEL_WORD[state]} muted={stale} />
      {group.summaryParts.length > 0 ? (
        <SummaryParts
          parts={group.summaryParts}
          stale={stale}
          className="text-[1.2rem] leading-snug font-semibold text-ink"
        />
      ) : (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[1.2rem] font-semibold">
          {group.rows.map((r) => (
            <div key={r.key} className="contents">
              <dt className="text-muted">{r.label}</dt>
              <dd className="m-0 truncate text-ink">{r.display}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}
