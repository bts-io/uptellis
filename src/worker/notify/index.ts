/**
 * Discord notifications from incidents: exactly one card when an incident opens and one when it resolves,
 * posted to the Discord webhook (the `DISCORD_WEBHOOK_URL` secret).
 *
 * - `stale` (a source went silent, and is back): always, as before.
 * - `down` (a service is down, and back up with the outage duration): only for sites whose config sets
 *   `notify.discord` (off by default, so a site still alerted by Uptime Kuma gets no second page). A service
 *   inside a maintenance window when its incident starts gets no card, and a resolve card goes out only for
 *   an incident whose open card was claimed, so nobody hears "back up" without having heard "down" (an
 *   outage that opened and closed within one input, or before this notifier sent down cards, stays quiet).
 *
 * Every place that writes transitions hands them here: the 5-minute sweep (src/worker/cron.ts) opens and
 * resolves `stale` ones, and an ingest or a probe run (`applyIngestDelta` in
 * src/worker/engine/ingest-service.ts) opens and resolves `down` ones and resolves `stale` ones when the
 * silent source reports again. Each transition is claimed in the `notifications` table before its card is
 * posted, so it is sent at most once, whoever sees it and however often a cron is retried. Sending runs in
 * `waitUntil` when the caller has one, and nothing here throws into the cron or the ingest.
 */
import { and, desc, eq, gt, isNotNull, lte, sql } from "drizzle-orm";
import type { Platform } from "@/platform/types";
import type { SiteConfig } from "@/shared/config";
import { FRESHNESS_FACTORS, type Incident, type Source } from "@/shared/model";
import { inMaintenance } from "@/shared/monitors";
import { type Db, schema } from "@/worker/db";
import { rowToIncident, rowToService, rowToSource } from "@/worker/db/rows";
import { toIso } from "@/worker/db/util";
import type { ConfigSource } from "@/worker/engine/sites";
import {
  type CardService,
  cardIsSafe,
  type DiscordCard,
  downCard,
  recoveredCard,
  silentSince,
  staleCard,
  upCard,
} from "./card";
import { postCard, type SendOptions, type SendOutcome } from "./send";

const { notifications, sources, heartbeats, services, incidents } = schema;

export type NotificationKind = "open" | "resolve";

export interface NotifierDeps {
  db: Db;
  configs: ConfigSource;
  webhookUrl: string;
  /** The platform's `waitUntil` (request or cron); without it, `notify` waits for the sends. */
  waitUntil?: (promise: Promise<unknown>) => void;
  send?: SendOptions;
  now?: () => number;
}

export interface Transitions {
  opened: readonly Incident[];
  resolved: readonly Incident[];
}

/** Logs a failed step by error name only (a message may quote SQL or values). */
const warn = (step: string, err: unknown) =>
  console.warn(JSON.stringify({ evt: "notify", step, name: err instanceof Error ? err.name : "unknown" }));

/** Why a `down` transition gets no card, or null when it gets one (pure; `config` null: unknown site). */
export function downCardBlock(
  config: Pick<SiteConfig, "notify" | "maintenance"> | null,
  kind: NotificationKind,
  incident: Pick<Incident, "serviceId" | "startedAt">,
): "notify_off" | "maintenance" | null {
  if (!config?.notify.discord || !incident.serviceId) return "notify_off";
  if (kind === "open" && inMaintenance(config, incident.serviceId, Date.parse(incident.startedAt))) {
    return "maintenance";
  }
  return null;
}

export class IncidentNotifier {
  constructor(private readonly deps: NotifierDeps) {}

  /** Posts a card for every `stale` and `down` transition in `t` (see above); others are ignored. Never throws. */
  async notify(site: string, t: Transitions): Promise<void> {
    const opens = (i: Incident) => i.endedAt === null;
    const jobs: (readonly [NotificationKind, Incident])[] = [
      ...t.opened
        .filter((i) => (i.kind === "stale" || i.kind === "down") && opens(i))
        .map((i) => ["open", i] as const),
      ...t.resolved
        .filter((i) => i.kind === "stale" || i.kind === "down")
        .map((i) => ["resolve", i] as const),
    ];
    if (jobs.length === 0) return;
    const run = (async () => {
      let config: SiteConfig | null | undefined;
      for (const [kind, incident] of jobs) {
        if (incident.kind === "down") {
          try {
            if (config === undefined) config = (await this.deps.configs.current(site))?.config ?? null;
            const blocked = downCardBlock(config, kind, incident);
            if (blocked) {
              if (blocked === "maintenance")
                console.log(JSON.stringify({ evt: "notify", kind, skipped: blocked }));
              continue;
            }
            if (kind === "resolve" && !(await this.claimed(site, incident.id, "open"))) continue;
          } catch (err) {
            warn("down_gate", err);
            continue;
          }
        }
        await this.deliver(site, kind, incident);
      }
    })();
    if (this.deps.waitUntil) this.deps.waitUntil(run);
    else await run;
  }

  /** Whether a card for this transition was claimed (sent, failed or in flight). */
  private async claimed(site: string, incidentId: string, kind: NotificationKind): Promise<boolean> {
    const [row] = await this.deps.db
      .select({ id: notifications.incidentId })
      .from(notifications)
      .where(
        and(
          eq(notifications.site, site),
          eq(notifications.incidentId, incidentId),
          eq(notifications.kind, kind),
        ),
      )
      .limit(1);
    return !!row;
  }

  /** One transition: claim it, build its card, post it, record the outcome. */
  private async deliver(site: string, kind: NotificationKind, incident: Incident): Promise<void> {
    const { db } = this.deps;
    const key = and(
      eq(notifications.site, site),
      eq(notifications.incidentId, incident.id),
      eq(notifications.kind, kind),
    );
    try {
      const claimed = await db
        .insert(notifications)
        .values({ site, incidentId: incident.id, kind, status: "pending" })
        .onConflictDoNothing()
        .returning({ id: notifications.incidentId });
      if (claimed.length === 0) return;

      const card = await this.card(site, kind, incident);
      const out: SendOutcome = !card
        ? { ok: false, status: 0, error: "unknown_source" }
        : !cardIsSafe(card)
          ? { ok: false, status: 0, error: "forbidden_literal" }
          : await postCard(this.deps.webhookUrl, card, this.deps.send);
      await db
        .update(notifications)
        .set(
          out.ok
            ? { status: "sent", sentAt: this.now(), error: null }
            : { status: "failed", sentAt: null, error: out.error },
        )
        .where(key);
      console.log(
        JSON.stringify({ evt: "notify", kind, sent: out.ok, ...(out.ok ? {} : { error: out.error }) }),
      );
    } catch (err) {
      warn("deliver", err);
      await db
        .update(notifications)
        .set({ status: "failed", error: "internal" })
        .where(key)
        .catch((e: unknown) => warn("record", e));
    }
  }

  private async card(site: string, kind: NotificationKind, incident: Incident): Promise<DiscordCard | null> {
    if (incident.kind === "down") return this.downCard(site, kind, incident);
    const [list, pageUrl] = await Promise.all([
      siteSources(this.deps.db, site),
      sitePageUrl(this.deps.configs, site),
    ]);
    const now = this.now();
    if (kind === "open") return staleCard({ site, incident, sources: list, pageUrl, now });
    const source = list.find((s) => s.id === incident.sourceId);
    if (!source) return null;
    const backfilled = await backfilledBeats(this.deps.db, site, incident, source);
    return recoveredCard({ site, incident, source, backfilled, pageUrl, now });
  }

  private async downCard(
    site: string,
    kind: NotificationKind,
    incident: Incident,
  ): Promise<DiscordCard | null> {
    const { db, configs } = this.deps;
    const serviceId = incident.serviceId;
    if (!serviceId) return null;
    const [row, state, pageUrl] = await Promise.all([
      db
        .select()
        .from(services)
        .where(and(eq(services.site, site), eq(services.id, serviceId)))
        .limit(1)
        .then((r) => r[0]),
      configs.current(site),
      sitePageUrl(configs, site),
    ]);
    if (!row) return null;
    const s = rowToService(row);
    const service: CardService = {
      id: s.id,
      source: s.source,
      targetDisplay: s.targetDisplay,
      name: state?.config.displayNames[s.id] ?? s.name,
    };
    const now = this.now();
    if (kind === "resolve") return upCard({ site, incident, service, pageUrl, now });
    const reason = await downReason(db, site, incident);
    return downCard({ site, incident, service, reason, pageUrl, now });
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }
}

/** The name the notifier had before it sent `down` cards. */
export { IncidentNotifier as StaleNotifier };

/** The message of the latest `down` heartbeat at or before the incident's start (the check that failed). */
async function downReason(db: Db, site: string, incident: Incident): Promise<string | null> {
  if (!incident.serviceId) return null;
  const [row] = await db
    .select({ message: heartbeats.message })
    .from(heartbeats)
    .where(
      and(
        eq(heartbeats.site, site),
        eq(heartbeats.serviceId, incident.serviceId),
        eq(heartbeats.status, "down"),
        lte(heartbeats.ts, Date.parse(incident.startedAt)),
      ),
    )
    .orderBy(desc(heartbeats.ts))
    .limit(1);
  return row?.message ?? null;
}

/**
 * The notifier for a platform, or undefined when its `DISCORD_WEBHOOK_URL` secret is not set. Sends run
 * in the platform's `waitUntil`. `now` is the clock the cards measure ages against (the cron passes its
 * scheduled time, the clock its sweep used).
 */
export function incidentNotifier(
  platform: Pick<Platform, "db" | "secret" | "waitUntil">,
  configs: ConfigSource,
  opts: { now?: () => number } = {},
): IncidentNotifier | undefined {
  const webhookUrl = platform.secret("DISCORD_WEBHOOK_URL");
  if (!webhookUrl) return undefined;
  return new IncidentNotifier({
    db: platform.db,
    configs,
    webhookUrl,
    waitUntil: (p: Promise<unknown>) => platform.waitUntil(p),
    ...(opts.now ? { now: opts.now } : {}),
  });
}

/** The name the factory had before the notifier sent `down` cards (src/worker/cron.ts still uses it). */
export const staleNotifier = incidentNotifier;

export type TestCardKind = "stale" | "recovered";

export type TestCardResult =
  | { ok: true; source: string; outcome: SendOutcome }
  | { ok: false; error: "no_source" };

/**
 * A card labelled TEST, built from the current state of one of the site's sources (`sourceId`, else the
 * first Kuma source, else the first one), for showing the cards without silencing a producer. Recorded
 * nowhere: it belongs to no incident.
 */
export async function sendTestCard(
  deps: Omit<NotifierDeps, "waitUntil">,
  site: string,
  kind: TestCardKind,
  sourceId?: string,
): Promise<TestCardResult> {
  const now = deps.now?.() ?? Date.now();
  const list = await siteSources(deps.db, site);
  const source = sourceId
    ? list.find((s) => s.id === sourceId)
    : (list.find((s) => s.kind === "kuma") ?? list[0]);
  if (!source) return { ok: false, error: "no_source" };
  const pageUrl = await sitePageUrl(deps.configs, site);

  let card: DiscordCard;
  if (kind === "stale") {
    const incident = testIncident(site, source, toIso(now), null);
    card = staleCard({ site, incident, sources: list, pageUrl, now, test: true });
  } else {
    // The source's latest real recovery, else a 10-minute gap ending at its last report.
    const [row] = await deps.db
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.site, site),
          eq(incidents.kind, "stale"),
          eq(incidents.sourceId, source.id),
          isNotNull(incidents.endedAt),
        ),
      )
      .orderBy(desc(incidents.endedAt))
      .limit(1);
    const end = source.lastSeenAt ? Date.parse(source.lastSeenAt) : now;
    const incident = row
      ? rowToIncident(row)
      : testIncident(site, source, toIso(end - 10 * 60_000 + staleMs(source)), toIso(end));
    const backfilled = await backfilledBeats(deps.db, site, incident, source);
    card = recoveredCard({ site, incident, source, backfilled, pageUrl, now, test: true });
  }
  if (!cardIsSafe(card))
    return { ok: true, source: source.id, outcome: { ok: false, status: 0, error: "forbidden_literal" } };
  return { ok: true, source: source.id, outcome: await postCard(deps.webhookUrl, card, deps.send) };
}

/** How long a source is silent before its `stale` incident starts. */
const staleMs = (source: Source) => FRESHNESS_FACTORS.stale * source.expectedIntervalS * 1000;

function testIncident(site: string, source: Source, startedAt: string, endedAt: string | null): Incident {
  return {
    id: `test:${source.id}`,
    site,
    kind: "stale",
    serviceId: null,
    sourceId: source.id,
    startedAt,
    endedAt,
    title: `Source ${source.id} stale`,
    notes: null,
  };
}

async function siteSources(db: Db, site: string): Promise<Source[]> {
  const rows = await db.select().from(sources).where(eq(sources.site, site)).orderBy(sources.id);
  return rows.map(rowToSource);
}

/** `https://<first hostname>/` of the site's config, or null. */
async function sitePageUrl(configs: ConfigSource, site: string): Promise<string | null> {
  const host = (await configs.current(site))?.config.hostnames[0];
  return host ? `https://${host}/` : null;
}

/**
 * Heartbeats of a Kuma source's services stored with a `ts` inside the silent window (after its last
 * report before the gap, up to the first one after): what the collector's resent beats filled in. Null
 * for other kinds, which resend nothing.
 */
async function backfilledBeats(
  db: Db,
  site: string,
  incident: Incident,
  source: Source,
): Promise<number | null> {
  if (source.kind !== "kuma" || !incident.endedAt) return null;
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(heartbeats)
    .innerJoin(services, and(eq(services.site, heartbeats.site), eq(services.id, heartbeats.serviceId)))
    .where(
      and(
        eq(heartbeats.site, site),
        eq(services.source, source.id),
        gt(heartbeats.ts, silentSince(incident, source)),
        lte(heartbeats.ts, Date.parse(incident.endedAt)),
      ),
    );
  return row?.n ?? 0;
}
