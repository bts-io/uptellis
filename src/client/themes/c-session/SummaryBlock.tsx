import type { ReactNode } from "react";
import { StateDot } from "@/client/kit";
import type { SiteView } from "@/shared/view";
import { isNewer } from "@/shared/view";
import { Block, DataAge, kumaSeenAt } from "./Block";
import { allServices, cx, DASH, fact, factText, failing, hhmmss, isStale, pct, splitUnit } from "./format";

/** One sentence that says whether anything needs you, then the stat strip. */
export function SummaryBlock({ view }: { view: SiteView }) {
  const s = view.summary;
  const stale = isStale(view);
  const services = allServices(view);
  // Once stale, the counts are the last known ones (the view counts stale services as `other`).
  const up = stale ? services.filter((x) => x.status === "up").length : s.up;
  const down = stale ? services.filter((x) => x.status === "down").length : s.down;
  const version = factText(view, "kuma.version");
  const latest = fact(view, "kuma.latestVersion");
  const [db, dbUnit] = splitUnit(factText(view, "kuma.dbSize"));

  return (
    <Block
      id="summary"
      title="Summary"
      command="status --summary"
      aside={<DataAge view={view} since={kumaSeenAt(view)} stale={stale} />}
      exitCode={s.down > 0 ? 1 : 0}
      stale={stale}
    >
      <Say view={view} up={up} />
      <dl className="m-0 mt-4 grid grid-cols-2 overflow-hidden rounded-lg border border-hair md:flex md:flex-wrap">
        <Stat label="monitors">
          {s.total}
          <Small>·</Small> <span className={cx(!stale && "text-up")}>{up}</span>
          <Small>up</Small> <span className={cx(down > 0 && "text-down")}>{down}</span>
          <Small>down</Small>
        </Stat>
        <Stat label="avg response">
          {s.avgLatencyMs === null ? DASH : Math.round(s.avgLatencyMs)}
          {s.avgLatencyMs !== null && <Small>ms</Small>}
        </Stat>
        <Stat label="health">{s.healthScore === null ? DASH : s.healthScore.toFixed(1)}</Stat>
        <Stat label="uptime 24h">
          {pct(s.uptime24h)}
          {s.uptime24h !== null && <Small>%</Small>}
        </Stat>
        <Stat label="uptime 30d">
          {pct(s.uptime30d)}
          {s.uptime30d !== null && <Small>%</Small>}
        </Stat>
        <Stat label="maintenance">{s.maintenance}</Stat>
        <Stat label="kuma">
          {version}
          {latest &&
            (isNewer(latest.display, version) ? (
              <Small className="text-degraded">{latest.display} available</Small>
            ) : (
              <Small>latest</Small>
            ))}
        </Stat>
        <Stat label="kuma db">
          {db}
          {dbUnit && <Small>{dbUnit}</Small>}
        </Stat>
      </dl>
    </Block>
  );
}

function Say({ view, up }: { view: SiteView; up: number }) {
  const s = view.summary;
  const serving = fact(view, "forgejo.servingNode");
  const replication = view.topology?.edges.find((e) => e.kind === "replication");
  const repl = fact(view, "replication.state");
  const replText = replication
    ? replication.live
      ? `replication ${repl?.display ?? "streaming"}`
      : (replication.detail ?? "replication stopped")
    : null;
  const names = allServices(view)
    .filter(failing)
    .map((x) => x.name);

  let dot: ReactNode;
  let text: ReactNode;
  if (view.freshness.state === "empty" || s.total === 0) {
    dot = <StateDot state="unknown" label="no data" />;
    text = <span>No monitor has reported yet.</span>;
  } else if (isStale(view)) {
    dot = <StateDot state="stale" />;
    text = (
      <span>
        Last known: <Em>{`${up}/${s.total}`}</Em> up as of <Em>{hhmmss(view.generatedAt)}</Em> UTC. The
        collector has gone quiet, so treat every value below as history.
      </span>
    );
  } else if (names.length) {
    dot = <StateDot state={s.down > 0 ? "down" : "degraded"} pulse />;
    text = (
      <span>
        <Em className={s.down > 0 ? "text-down" : "text-degraded"}>{`${names.length} of ${s.total}`}</Em>{" "}
        {s.down > 0 ? "down" : "degraded"}: {names.join(", ")}.
        {serving && (
          <>
            {" "}
            Forgejo still serving from <Em>{serving.display}</Em>
            {replText ? `; ${replText}.` : "."}
          </>
        )}
      </span>
    );
  } else {
    dot = <StateDot state="up" pulse />;
    text = (
      <span>
        All <Em>{String(s.total)}</Em> monitors up.
        {serving && (
          <>
            {" "}
            Forgejo serving from <Em>{serving.display}</Em>
            {replText ? `, ${replText}` : ""}, nothing needs you.
          </>
        )}
      </span>
    );
  }
  return (
    <p className="m-0 flex items-baseline gap-3 font-sans text-[17px] leading-[1.35] font-medium tracking-[-0.01em] md:text-xl [&>[role=img]]:-top-0.5 [&>[role=img]]:size-2.5">
      {dot}
      {text}
    </p>
  );
}

function Em({ children, className }: { children: string; className?: string }) {
  return <em className={cx("font-mono text-[15.5px] not-italic md:text-lg", className)}>{children}</em>;
}

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-hair px-3 pt-[9px] pb-[9px] max-md:border-b max-md:odd:border-r md:flex-auto md:border-r md:px-[18px] md:pt-2.5 md:pb-[11px] md:last:border-r-0">
      <dt className="font-sans text-xs leading-[1.2] text-muted">{label}</dt>
      <dd className="m-0 mt-1 font-mono text-[15px] leading-[1.3] font-medium whitespace-nowrap md:text-[17px]">
        {children}
      </dd>
    </div>
  );
}

function Small({ children, className }: { children: ReactNode; className?: string }) {
  return <small className={cx("ml-[3px] text-xs font-normal", className ?? "text-muted")}>{children}</small>;
}
