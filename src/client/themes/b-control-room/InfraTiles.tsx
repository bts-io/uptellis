import { StateDot } from "@/client/kit";
import type { DisplayState, Level, SiteView } from "@/shared/view";
import { allServices, DASH, fact, factText, levelState, probeStale, targetHost } from "./format";
import { Chip, Kv, Micro, Tile, TileHead } from "./ui";

/** Forgejo: version and serving node, endpoint, watchdog and the serving node's disk. */
export function ForgejoTile({ view }: { view: SiteView }) {
  const stale = probeStale(view);
  const healthz = fact(view, "forgejo.healthzCode");
  const version = fact(view, "forgejo.version");
  const watchdog = fact(view, "watchdog.reachable");
  const endpoint = allServices(view).find((s) => s.kind === "http" || s.kind === "keyword");
  return (
    <Tile stale={stale}>
      <TileHead>
        <Micro>Forgejo</Micro>
        {healthz && (
          <Chip level={healthz.level ?? "info"}>healthz {healthz.display.replace(/^HTTP /, "")}</Chip>
        )}
      </TileHead>
      <div className="px-4 pt-2 pb-3.5">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[22px] font-medium">{version ? `v${version.display}` : DASH}</span>
          <span className="text-[12.5px] text-muted">on {factText(view, "forgejo.servingNode")}</span>
        </div>
        <div className="mt-2.5">
          <Kv k="endpoint">{endpoint ? targetHost(endpoint) : DASH}</Kv>
          <Kv k="watchdog">
            {watchdog && <StateDot state={stale ? "stale" : levelState(watchdog.level)} />}
            {watchdog?.display ?? DASH}
          </Kv>
          <Kv k={`disk ${factText(view, "forgejo.node")}`}>{factText(view, "disk.display")}</Kv>
        </div>
      </div>
    </Tile>
  );
}

/** `runner-1 (idle), watch-1 (busy)` as name and status pairs. */
const parseRunners = (list: string) =>
  list
    .split(",")
    .map((r) => r.trim().match(/^(\S+)(?:\s+\((.+)\))?$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ name: m[1]!, status: m[2] ?? DASH }));

const runnerState = (status: string): DisplayState =>
  status === "offline" ? "down" : status === DASH ? "unknown" : "up";

/** CI runners: one row per runner with its status. */
export function RunnersTile({ view }: { view: SiteView }) {
  const stale = probeStale(view);
  const list = fact(view, "runners.list");
  const runners = list ? parseRunners(list.display) : [];
  return (
    <Tile stale={stale}>
      <TileHead>
        <Micro>CI runners</Micro>
        <span className="font-mono text-[11.5px] text-muted">{factText(view, "runners.online")} online</span>
      </TileHead>
      <div className="px-4 pt-2 pb-3">
        {runners.length ? (
          runners.map((r) => (
            <Kv
              key={r.name}
              className="py-[9px]"
              k={
                <span className="flex items-center gap-2.5 text-ink">
                  <StateDot state={stale ? "stale" : runnerState(r.status)} />
                  {r.name}
                </span>
              }
            >
              <span className="text-muted">{r.status}</span>
            </Kv>
          ))
        ) : (
          <Kv k="runners">{DASH}</Kv>
        )}
      </div>
    </Tile>
  );
}

const RING: Record<Level, string> = {
  ok: "stroke-up",
  warn: "stroke-degraded",
  crit: "stroke-down",
  info: "stroke-maint",
};

/** Backup: the last run's result as a ring, then when it ran, its size and duration, and the next run. */
export function BackupTile({ view }: { view: SiteView }) {
  const stale = probeStale(view);
  const result = fact(view, "backup.lastResult");
  const snapshot = fact(view, "backup.snapshot");
  const next = fact(view, "backup.nextAt");
  const level: Level = result?.level ?? "info";
  const r = 34;
  return (
    <Tile stale={stale} className="flex flex-col min-[1100px]:col-span-4">
      <TileHead>
        <Micro>Backup</Micro>
        {snapshot && <Chip level={level}>✓ {snapshot.display}</Chip>}
      </TileHead>
      <div className="flex flex-1 items-center gap-5 px-4 pt-3 pb-4">
        <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true" className="flex-none">
          <circle cx="42" cy="42" r={r} fill="none" className="stroke-hair" strokeWidth="6" />
          {result && (
            <circle
              cx="42"
              cy="42"
              r={r}
              fill="none"
              className={RING[level]}
              strokeWidth="6"
              strokeLinecap="round"
            />
          )}
          <text x="42" y="44" textAnchor="middle" className="fill-ink font-mono text-[13px] font-medium">
            {result?.display ?? DASH}
          </text>
          <text
            x="42"
            y="57"
            textAnchor="middle"
            className="fill-muted font-mono text-[9.5px] tracking-[.08em]"
          >
            LAST RUN
          </text>
        </svg>
        <div className="min-w-0 flex-1">
          <Kv k="last">{factText(view, "backup.lastAt")}</Kv>
          <Kv k="size · took">
            {factText(view, "backup.size")} · {factText(view, "backup.durationS")}
          </Kv>
          <Kv k="next">
            <span
              className={
                next?.level === "warn" ? "text-degraded" : next?.level === "crit" ? "text-down" : "text-maint"
              }
            >
              {next?.display ?? DASH}
            </span>
          </Kv>
        </div>
      </div>
    </Tile>
  );
}

/** The machines of the topology (tailnet hostnames only): state, roles, location. */
export function TailnetTile({ view }: { view: SiteView }) {
  const stale = probeStale(view);
  const nodes = view.topology?.nodes ?? [];
  const up = nodes.filter((n) => n.state === "up").length;
  return (
    <Tile stale={stale} className="min-[1100px]:col-span-4">
      <TileHead>
        <Micro>Tailnet</Micro>
        <span className="font-mono text-xs">
          <b className="font-medium">{up}</b>
          <span className="text-muted">/{nodes.length} up</span>
        </span>
      </TileHead>
      <div className="px-4 pt-3 pb-3.5">
        {nodes.length ? (
          <>
            <div className="mb-2.5 flex gap-2 [&>span]:size-2.5">
              {nodes.map((n) => (
                <StateDot key={n.id} state={stale ? "stale" : n.state} label={`${n.label} ${n.state}`} />
              ))}
            </div>
            {nodes.map((n) => (
              <Kv
                key={n.id}
                k={
                  <span className="flex items-center gap-2 text-ink">
                    <StateDot state={stale ? "stale" : n.state} />
                    {n.label}
                  </span>
                }
              >
                <span className="truncate">
                  <span className="text-muted">{n.roles.join(" + ")}</span>
                  {n.location && ` · ${n.location}`}
                </span>
              </Kv>
            ))}
          </>
        ) : (
          <Kv k="machines">{DASH}</Kv>
        )}
      </div>
    </Tile>
  );
}
