import { and, asc, desc, eq, getTableColumns, gte, isNull, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Platform } from "@/platform/types";
import { type Incident, type Service, type Source, type SourceKind, sourceKindOf } from "@/shared/model";
import type { ModelDelta } from "@/shared/schemas";
import { type Db, schema } from "@/worker/db";
import { countsFromRow, DAY_MS, foldHistory, HISTORY_DAYS, ROLLUP_BUCKET_MS } from "@/worker/db/history";
import {
  factToRow,
  heartbeatToRow,
  incidentToRow,
  rowToFact,
  rowToHeartbeat,
  rowToIncident,
  rowToService,
  rowToSource,
  serviceToRow,
} from "@/worker/db/rows";
import { chunk, excluded, rowsPerInsert, toIso, toMs } from "@/worker/db/util";
import {
  deriveDeltaIncidents,
  deriveStaleIncidents,
  type IncidentTransitions,
  isOutdatedDelta,
} from "./incidents";
import {
  type ApplyResult,
  assertDeltaSite,
  RECENT_BEATS,
  type ServiceDays,
  type SiteModel,
  type SnapshotRecord,
  type SourceSpec,
  type Store,
} from "./store";

const { services, heartbeats, facts, factSamples, incidents, sources, ingestNonces, snapshots } = schema;

type Stmt = BatchItem<"sqlite">;

/** Expected interval for a source first seen through ingest, before a site config sets its own. */
export const DEFAULT_INTERVAL_S: Record<SourceKind, number> = {
  kuma: 60,
  facts: 900,
  webhook: 300,
  probe: 60,
};

/** How far back `recentIncidents` reaches. */
export const RECENT_INCIDENT_DAYS = 30;
const RECENT_INCIDENT_LIMIT = 500;

const empty = (): ApplyResult => ({
  servicesUpserted: 0,
  heartbeatsInserted: 0,
  factsUpserted: 0,
  incidentsOpened: [],
  incidentsResolved: [],
});

// Rows per INSERT under D1's 100 bound parameters (column counts of each table as inserted).
const SERVICE_ROWS = rowsPerInsert(17);
const HEARTBEAT_ROWS = rowsPerInsert(7);
const FACT_ROWS = rowsPerInsert(12);
const SAMPLE_ROWS = rowsPerInsert(5);
const INCIDENT_ROWS = rowsPerInsert(10);

/**
 * `Store` on the platform's SQL database (D1 or SQLite). Reads run before the write batch; every write of
 * one call lands in a single `platform.batch`.
 */
export class D1Store implements Store {
  readonly db: Db;

  constructor(private readonly platform: Pick<Platform, "db" | "batch">) {
    this.db = platform.db;
  }

  async applyDelta(delta: ModelDelta): Promise<ApplyResult> {
    const { site } = delta;
    assertDeltaSite(delta);

    const generatedAt = toMs(delta.generatedAt);
    const seenAt = toMs(delta.source.seenAt);
    const since = Math.min(generatedAt, seenAt, ...delta.heartbeats.map((h) => toMs(h.ts)));
    const [before, known, sourceRows] = await Promise.all([
      this.currentServices(site),
      this.knownIncidents(site, since),
      this.db
        .select()
        .from(sources)
        .where(and(eq(sources.site, site), eq(sources.id, delta.source.sourceId))),
    ]);

    // The touched source as it will be after this batch, for closing a `stale` incident.
    const existing = sourceRows[0] ? rowToSource(sourceRows[0]) : null;
    const outdated = isOutdatedDelta(delta, existing);
    const kind = sourceKindOf(delta.source.sourceId);
    const lastSeen = Math.max(seenAt, existing?.lastSeenAt ? toMs(existing.lastSeenAt) : seenAt);
    const touched: Source = {
      id: delta.source.sourceId,
      site,
      kind,
      expectedIntervalS: existing?.expectedIntervalS ?? DEFAULT_INTERVAL_S[kind],
      lastSeenAt: toIso(lastSeen),
      lastOkAt: existing?.lastOkAt ?? null,
    };

    const transitions = deriveDeltaIncidents({
      delta,
      before,
      incidents: known,
      previous: existing,
      touched,
    });

    const now = Date.now();
    const db = this.db;
    const head: Stmt = db
      .insert(sources)
      .values({
        site,
        id: delta.source.sourceId,
        kind,
        expectedIntervalS: DEFAULT_INTERVAL_S[kind],
        lastSeenAt: seenAt,
        lastOkAt: delta.source.ok ? seenAt : null,
        lastError: delta.source.error,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [sources.site, sources.id],
        set: {
          lastSeenAt: sql`max(coalesce(${sources.lastSeenAt}, 0), ${excluded(sources.lastSeenAt)})`,
          lastOkAt: sql`case when ${excluded(sources.lastOkAt)} is null then ${sources.lastOkAt}
            else max(coalesce(${sources.lastOkAt}, 0), ${excluded(sources.lastOkAt)}) end`,
          // A late (outdated) delta never replaces the error of a newer one.
          lastError: outdated ? sources.lastError : excluded(sources.lastError),
          updatedAt: excluded(sources.updatedAt),
        },
      });
    const rest: Stmt[] = [];

    for (const part of chunk(delta.services, SERVICE_ROWS)) {
      rest.push(
        db
          .insert(services)
          .values(part.map((s) => serviceToRow(s, generatedAt)))
          .onConflictDoUpdate({
            target: [services.site, services.id],
            set: Object.fromEntries(
              (
                [
                  "source",
                  "externalId",
                  "name",
                  "kind",
                  "targetDisplay",
                  "intervalS",
                  "method",
                  "timeoutS",
                  "status",
                  "latencyMs",
                  "avgLatencyMs",
                  "uptime24h",
                  "uptime30d",
                  "cert",
                  "observedAt",
                ] as const
              ).map((k) => [k, excluded(services[k])]),
            ),
            setWhere: sql`${excluded(services.observedAt)} >= ${services.observedAt}`,
          }),
      );
    }

    const heartbeatStart = rest.length;
    for (const part of chunk(delta.heartbeats, HEARTBEAT_ROWS)) {
      rest.push(
        db
          .insert(heartbeats)
          .values(part.map(heartbeatToRow))
          .onConflictDoNothing()
          .returning({ ts: heartbeats.ts }),
      );
    }
    const heartbeatEnd = rest.length;

    for (const part of chunk(delta.facts, FACT_ROWS)) {
      rest.push(
        db
          .insert(facts)
          .values(part.map(factToRow))
          .onConflictDoUpdate({
            target: [facts.site, facts.grp, facts.key],
            set: Object.fromEntries(
              (
                [
                  "source",
                  "valueType",
                  "valueText",
                  "valueNum",
                  "valueBool",
                  "unit",
                  "severity",
                  "observedAt",
                  "freshForS",
                ] as const
              ).map((k) => [k, excluded(facts[k])]),
            ),
            setWhere: sql`${excluded(facts.observedAt)} >= ${facts.observedAt}`,
          })
          .returning({ key: facts.key }),
      );
    }
    const factEnd = rest.length;

    const samples = delta.facts.flatMap((f) =>
      f.value.type === "number"
        ? [{ site, grp: f.group, key: f.key, ts: toMs(f.observedAt), value: f.value.value }]
        : [],
    );
    for (const part of chunk(samples, SAMPLE_ROWS)) {
      rest.push(db.insert(factSamples).values(part).onConflictDoNothing());
    }

    const incidentStart = rest.length;
    rest.push(...this.incidentStatements(site, transitions, now));

    const results = (await this.platform.batch([head, ...rest])) as unknown[];
    const out = results.slice(1);
    const count = (from: number, to: number) =>
      out.slice(from, to).reduce<number>((n, r) => n + (Array.isArray(r) ? r.length : 0), 0);

    return {
      servicesUpserted: delta.services.length,
      heartbeatsInserted: count(heartbeatStart, heartbeatEnd),
      factsUpserted: count(heartbeatEnd, factEnd),
      ...this.confirmed(transitions, out.slice(incidentStart)),
    };
  }

  async claimNonce(nonce: string, expiresAt: string): Promise<boolean> {
    const rows = await this.db
      .insert(ingestNonces)
      .values({ nonce, expiresAt: toMs(expiresAt) })
      .onConflictDoNothing()
      .returning({ nonce: ingestNonces.nonce });
    return rows.length > 0;
  }

  async loadSiteModel(site: string, now: string): Promise<SiteModel> {
    const cutoff = toMs(now) - RECENT_INCIDENT_DAYS * DAY_MS;
    const ranked = this.db
      .select({
        ...getTableColumns(heartbeats),
        rn: sql<number>`row_number() over (partition by ${heartbeats.serviceId} order by ${heartbeats.ts} desc)`.as(
          "rn",
        ),
      })
      .from(heartbeats)
      .where(eq(heartbeats.site, site))
      .as("ranked");

    const [sourceRows, serviceRows, beatRows, openRows, recentRows, factRows] = await Promise.all([
      this.db.select().from(sources).where(eq(sources.site, site)).orderBy(asc(sources.id)),
      this.serviceRows(site),
      this.db
        .select()
        .from(ranked)
        .where(sql`${ranked.rn} <= ${RECENT_BEATS}`)
        .orderBy(asc(ranked.serviceId), desc(ranked.ts)),
      this.db
        .select()
        .from(incidents)
        .where(and(eq(incidents.site, site), isNull(incidents.endedAt)))
        .orderBy(desc(incidents.startedAt)),
      this.db
        .select()
        .from(incidents)
        .where(and(eq(incidents.site, site), or(isNull(incidents.endedAt), gte(incidents.endedAt, cutoff))))
        .orderBy(desc(incidents.startedAt))
        .limit(RECENT_INCIDENT_LIMIT),
      this.db.select().from(facts).where(eq(facts.site, site)).orderBy(asc(facts.grp), asc(facts.key)),
    ]);

    return {
      site,
      generatedAt: now,
      sources: sourceRows.map(rowToSource),
      services: serviceRows.map(rowToService),
      recentHeartbeats: beatRows.map(({ rn: _, ...r }) => rowToHeartbeat(r)),
      openIncidents: openRows.map(rowToIncident),
      recentIncidents: recentRows.map(rowToIncident),
      facts: factRows.map(rowToFact),
    };
  }

  /**
   * Per service and UTC day over the 90 days ending with the day of `now`: the `heartbeat_5m` rollup, plus
   * the raw beats of windows the 5-minute cron has not folded yet (the current window, and a late window
   * awaiting its refold). Two single statements, no bound-parameter lists.
   */
  async loadHistory(site: string, now: string): Promise<ServiceDays[]> {
    const nowMs = toMs(now);
    const from = (Math.floor(nowMs / DAY_MS) - (HISTORY_DAYS - 1)) * DAY_MS;
    // Literals, not bound parameters: D1 binds JS numbers as REAL, which would turn the integer divisions
    // into float divisions (as in the cron's downsample).
    const day = sql.raw(String(DAY_MS));
    const width = sql.raw(String(ROLLUP_BUCKET_MS));
    const minutes = sql.raw(String(ROLLUP_BUCKET_MS / 60_000));
    const [rolled, raw] = await Promise.all([
      this.db.all<Record<string, unknown>>(sql`
        select service_id, bucket / ${day} as day_idx, sum(total) as total, sum(up) as up, sum(down) as down,
          sum(maint) as maint, sum(pending) as pending, sum(${minutes}.0 * down / total) as minutes_down
        from heartbeat_5m
        where site = ${site} and bucket >= ${from} and bucket <= ${nowMs} and total > 0
        group by service_id, day_idx
      `),
      this.db.all<Record<string, unknown>>(sql`
        select service_id, day_idx, sum(total) as total, sum(up) as up, sum(down) as down,
          sum(maint) as maint, sum(pending) as pending, sum(${minutes}.0 * down / total) as minutes_down
        from (
          select service_id, (ts / ${width}) * ${width} / ${day} as day_idx, count(*) as total,
            sum(status = 'up') as up, sum(status = 'down') as down, sum(status = 'maintenance') as maint,
            sum(status = 'pending') as pending
          from heartbeats as hb
          where site = ${site} and ts >= ${from} and ts <= ${nowMs}
            and not exists (
              select 1 from heartbeat_5m as r
              where r.site = hb.site and r.service_id = hb.service_id and r.bucket = (hb.ts / ${width}) * ${width}
            )
          group by service_id, ts / ${width}
        )
        group by service_id, day_idx
      `),
    ]);
    return foldHistory([...rolled, ...raw].map(countsFromRow));
  }

  async currentServices(site: string): Promise<Service[]> {
    return (await this.serviceRows(site)).map(rowToService);
  }

  async sweepStaleness(site: string, now: string): Promise<ApplyResult> {
    const rows = await this.db.select().from(sources).where(eq(sources.site, site));
    const list = rows.map(rowToSource);
    const seen = list.flatMap((s) => (s.lastSeenAt ? [toMs(s.lastSeenAt)] : []));
    if (seen.length === 0) return empty();
    const known = await this.knownIncidents(site, Math.min(...seen));
    const transitions = deriveStaleIncidents({ site, sources: list, incidents: known, now });
    const stmts = this.incidentStatements(site, transitions, Date.now());
    if (stmts.length === 0) return empty();
    const [first, ...others] = stmts as [Stmt, ...Stmt[]];
    const results = (await this.platform.batch([first, ...others])) as unknown[];
    return { ...empty(), ...this.confirmed(transitions, results) };
  }

  /* ---------------------------------------------------------------- */
  /* Sites for the cron, config sync and raw snapshots                */
  /* ---------------------------------------------------------------- */

  /** Sites that have at least one source (the cron sweeps these). */
  async listSites(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ site: sources.site })
      .from(sources)
      .orderBy(asc(sources.site));
    return rows.map((r) => r.site);
  }

  /** Creates or updates the site's sources from its config (expected intervals); keeps last seen and ok. */
  async syncSources(site: string, list: readonly SourceSpec[]): Promise<void> {
    const now = Date.now();
    const stmts: Stmt[] = list.map((s) =>
      this.db
        .insert(sources)
        .values({ site, id: s.id, kind: s.kind, expectedIntervalS: s.expectedIntervalS, updatedAt: now })
        .onConflictDoUpdate({
          target: [sources.site, sources.id],
          set: { expectedIntervalS: s.expectedIntervalS, updatedAt: now },
        }),
    );
    const [first, ...others] = stmts;
    if (first) await this.platform.batch([first, ...others]);
  }

  /** Keeps a raw accepted payload for 7 days (debugging). */
  async recordSnapshot(input: SnapshotRecord): Promise<void> {
    await this.db.insert(snapshots).values({ ...input, generatedAt: toMs(input.generatedAt) });
  }

  /* ---------------------------------------------------------------- */

  private serviceRows(site: string) {
    return this.db
      .select()
      .from(services)
      .where(eq(services.site, site))
      .orderBy(asc(services.source), sql`length(${services.externalId})`, asc(services.externalId));
  }

  /** Open incidents plus closed ones that ended at or after `since` (enough for idempotent derivation). */
  private async knownIncidents(site: string, since: number): Promise<Incident[]> {
    const rows = await this.db
      .select()
      .from(incidents)
      .where(and(eq(incidents.site, site), or(isNull(incidents.endedAt), gte(incidents.endedAt, since))));
    return rows.map(rowToIncident);
  }

  /** Inserts for opened incidents (chunked), then one guarded update per resolved one. */
  private incidentStatements(site: string, t: IncidentTransitions, now: number): Stmt[] {
    const stmts: Stmt[] = [];
    for (const part of chunk(t.opened, INCIDENT_ROWS)) {
      stmts.push(
        this.db
          .insert(incidents)
          .values(part.map((i) => incidentToRow(i, now)))
          .onConflictDoNothing()
          .returning({ id: incidents.id }),
      );
    }
    for (const i of t.resolved) {
      stmts.push(
        this.db
          .update(incidents)
          .set({ endedAt: toMs(i.endedAt ?? ""), updatedAt: now })
          .where(and(eq(incidents.site, site), eq(incidents.id, i.id), isNull(incidents.endedAt)))
          .returning({ id: incidents.id }),
      );
    }
    return stmts;
  }

  /** The transitions the batch actually wrote (a concurrent writer may have got there first). */
  private confirmed(t: IncidentTransitions, results: unknown[]) {
    const ids = new Set<string>();
    for (const r of results) {
      if (Array.isArray(r)) for (const row of r as { id?: string }[]) if (row.id) ids.add(row.id);
    }
    // An incident opened and closed in the same batch is inserted closed: its insert returns the id and
    // its (then redundant) update matches nothing.
    return {
      incidentsOpened: t.opened.filter((i) => ids.has(i.id)),
      incidentsResolved: t.resolved.filter((i) => ids.has(i.id)),
    };
  }
}
