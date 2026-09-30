/**
 * The notification dispatcher: one `AlertMessage` per incident transition, sent to every channel of the
 * site that wants it (`channelsOf` and `channelWants` in src/shared/notify), each through its provider
 * (./providers). The historical Discord behaviour is the implicit `discord` channel `channelsOf` adds.
 *
 * - `stale` (a source went silent) and `recovered` (it is back); `down` (a service is down) and `up` (back
 *   up, with the outage duration). Which of them a channel gets is its `events` and `services`.
 * - A service inside a maintenance window when its incident starts gets no `down` anywhere. An `up` or a
 *   `recovered` goes to a channel only if that channel's `down` or `stale` was sent, is in flight or may
 *   still be retried, so nobody hears "back up" without having heard "down". A source or monitor resolved
 *   because it left the config (`QUIET_NOTES`: `RETIRED_NOTE`, `REMOVED_MONITOR_NOTE`) sends nothing.
 * - The implicit Discord channel is skipped quietly while `DISCORD_WEBHOOK_URL` is unset; a configured
 *   channel whose secret is missing is recorded as `failed secret_missing`.
 *
 * Every place that writes transitions hands them here: the 5-minute sweep (src/worker/cron.ts) opens and
 * resolves `stale` ones, and an ingest or a probe run (`applyIngestDelta` in
 * src/worker/engine/ingest-service.ts) opens and resolves `down` ones and resolves `stale` ones when the
 * silent source reports again. Each (transition, channel) is claimed in the `notifications` table before
 * it is sent, so it is sent at most once, whoever sees it and however often a cron is retried. Channels
 * are sent to side by side; a failing one never holds up the others. A retryable failure is retried in the
 * request (./retry.ts), then by the five-minute job (`retryFailed`) for up to an hour. Sending runs in
 * `waitUntil` when the caller has one, and nothing here throws into the cron or the ingest.
 */
import { and, desc, eq, gt, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { Platform } from "@/platform/types";
import type { SiteConfig } from "@/shared/config";
import { FRESHNESS_FACTORS, type Incident, type Source } from "@/shared/model";
import { inMaintenance } from "@/shared/monitors";
import {
  AlertMessage,
  type ChannelConfig,
  channelsOf,
  channelWants,
  type DeliveryOutcome,
  type EmailSender,
  LEGACY_DISCORD_CHANNEL,
  LEGACY_DISCORD_SECRET,
  type NotifyEvent,
  type ProviderContext,
} from "@/shared/notify";
import { type Db, schema } from "@/worker/db";
import { rowToIncident, rowToService, rowToSource } from "@/worker/db/rows";
import { toIso } from "@/worker/db/util";
import { QUIET_NOTES } from "@/worker/engine/incidents";
import type { ConfigSource } from "@/worker/engine/sites";
import pkg from "../../../package.json";
import { type CardService, downMessage, recoveredMessage, staleMessage, upMessage } from "./alerts";
import { silentSince } from "./format";
import { sendVia } from "./providers";
import { type Sleep, sendWithRetries } from "./retry";

const { notifications, sources, heartbeats, services, incidents } = schema;

export type NotificationKind = "open" | "resolve";

/** How long after its claim a retryable failure is retried by the five-minute job. */
export const RETRY_WINDOW_MS = 60 * 60_000;
/** Rows the five-minute job retries per run at most. */
export const RETRY_BATCH = 50;

export interface NotifierDeps {
  db: Db;
  configs: ConfigSource;
  /** `Platform.notifySecret`: a channel secret by name, undefined when unset. */
  secret: (name: string) => string | undefined;
  /** The instance's email sender (`Platform.email`). */
  email?: EmailSender | null;
  /** The `EMAIL_FROM` setting. */
  emailFrom?: string;
  /** The platform's `waitUntil` (request or cron); without it, `notify` waits for the sends. */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Defaults to the global fetch (looked up per call). */
  fetch?: typeof fetch;
  /** The waits between in-request retries (tests pass a fake). */
  sleep?: Sleep;
  now?: () => number;
}

export interface Transitions {
  opened: readonly Incident[];
  resolved: readonly Incident[];
}

/** Logs a failed step by error name only (a message may quote SQL or values). */
const warn = (step: string, err: unknown) =>
  console.warn(JSON.stringify({ evt: "notify", step, name: err instanceof Error ? err.name : "unknown" }));

/** The event of a transition: an opened or resolved `down` or `stale` incident. */
export const eventOf = (kind: NotificationKind, incident: Pick<Incident, "kind">): NotifyEvent =>
  incident.kind === "down" ? (kind === "open" ? "down" : "up") : kind === "open" ? "stale" : "recovered";

/** Whether a `down` that opens at the incident's start is inside a maintenance window (pure). */
export function inMaintenanceAtStart(
  config: Pick<SiteConfig, "maintenance"> | null,
  incident: Pick<Incident, "serviceId" | "startedAt">,
): boolean {
  if (!config || !incident.serviceId) return false;
  return inMaintenance(config, incident.serviceId, Date.parse(incident.startedAt));
}

/** The channels of a site (the implicit Discord one only, for a site without a config). */
const siteChannels = (config: SiteConfig | null) =>
  channelsOf(config?.notify ?? { discord: false, channels: [] });

/** True for the Discord channel `channelsOf` adds, as opposed to one the config lists. */
const isImplicit = (config: SiteConfig | null, channel: ChannelConfig) =>
  channel.id === LEGACY_DISCORD_CHANNEL &&
  channel.type === "discord" &&
  channel.secret === LEGACY_DISCORD_SECRET &&
  !(config?.notify.channels ?? []).some((c) => c.id === channel.id);

type Built = { ok: true; message: AlertMessage } | { ok: false; error: string };

export class IncidentNotifier {
  constructor(private readonly deps: NotifierDeps) {}

  /** Sends every `stale` and `down` transition in `t` to its channels (see above). Never throws. */
  async notify(site: string, t: Transitions): Promise<void> {
    const jobs: (readonly [NotificationKind, Incident])[] = [
      ...t.opened
        .filter((i) => (i.kind === "stale" || i.kind === "down") && i.endedAt === null)
        .map((i) => ["open", i] as const),
      ...t.resolved
        .filter((i) => (i.kind === "stale" || i.kind === "down") && !(i.notes && QUIET_NOTES.has(i.notes)))
        .map((i) => ["resolve", i] as const),
    ];
    if (jobs.length === 0) return;
    const run = (async () => {
      let config: SiteConfig | null;
      try {
        config = (await this.deps.configs.current(site))?.config ?? null;
      } catch (err) {
        warn("config", err);
        return;
      }
      for (const [kind, incident] of jobs) {
        await this.dispatch(site, config, kind, incident).catch((err: unknown) => warn("dispatch", err));
      }
    })();
    if (this.deps.waitUntil) this.deps.waitUntil(run);
    else await run;
  }

  /** One transition: every channel that wants it, side by side. */
  private async dispatch(
    site: string,
    config: SiteConfig | null,
    kind: NotificationKind,
    incident: Incident,
  ): Promise<void> {
    const event = eventOf(kind, incident);
    const serviceId = incident.kind === "down" ? incident.serviceId : null;
    if (incident.kind === "down" && !serviceId) return;
    if (event === "down" && inMaintenanceAtStart(config, incident)) {
      console.log(JSON.stringify({ evt: "notify", kind, event, skipped: "maintenance" }));
      return;
    }
    const channels = siteChannels(config).filter(
      (c) =>
        channelWants(c, event, serviceId) &&
        !(isImplicit(config, c) && !this.deps.secret(LEGACY_DISCORD_SECRET)),
    );
    if (channels.length === 0) return;
    let built: Promise<Built> | undefined;
    const message = () => (built ??= this.build(site, config, kind, incident, this.now()));
    await Promise.all(
      channels.map((c) =>
        this.deliver(site, kind, incident, c, message).catch((err: unknown) => warn("deliver", err)),
      ),
    );
  }

  /** Whether `channel` heard the opening of this incident (sent, in flight, or still to be retried). */
  private async opened(site: string, incidentId: string, channel: string): Promise<boolean> {
    const [row] = await this.deps.db
      .select({ status: notifications.status, retryable: notifications.retryable })
      .from(notifications)
      .where(
        and(
          eq(notifications.site, site),
          eq(notifications.incidentId, incidentId),
          eq(notifications.kind, "open"),
          eq(notifications.channel, channel),
        ),
      )
      .limit(1);
    return !!row && (row.status !== "failed" || row.retryable);
  }

  /** One transition to one channel: claim it, send it (with retries), record the outcome. */
  private async deliver(
    site: string,
    kind: NotificationKind,
    incident: Incident,
    channel: ChannelConfig,
    message: () => Promise<Built>,
  ): Promise<void> {
    const { db } = this.deps;
    if (kind === "resolve" && !(await this.opened(site, incident.id, channel.id))) return;
    const key = rowKey(site, incident.id, kind, channel.id);
    const claimed = await db
      .insert(notifications)
      .values({
        site,
        incidentId: incident.id,
        kind,
        channel: channel.id,
        status: "pending",
        attempts: 0,
        retryable: false,
        createdAt: this.now(),
      })
      .onConflictDoNothing()
      .returning({ id: notifications.incidentId });
    if (claimed.length === 0) return;
    const event = eventOf(kind, incident);
    try {
      const built = await message();
      const { outcome, attempts } = built.ok
        ? await sendWithRetries(() => sendVia(built.message, channel, this.context()), this.retryOptions())
        : { outcome: final(built.error), attempts: 0 };
      await this.record(key, outcome, attempts);
      logOutcome(kind, event, channel, outcome, attempts);
    } catch (err) {
      warn("deliver", err);
      await this.record(key, final("internal"), 0).catch((e: unknown) => warn("record", e));
    }
  }

  /**
   * The five-minute job's pass: every delivery still `failed` and retryable, claimed within the last hour,
   * is tried once more with a message rebuilt from its incident. A delivery whose channel or incident is
   * gone fails for good (`channel_gone`, `incident_gone`), and so does the `down` or `stale` of an incident
   * that has resolved since (`superseded`): hearing it after the all-clear would only confuse. Runs in
   * `waitUntil` when there is one; never throws.
   */
  async retryFailed(): Promise<void> {
    const run = (async () => {
      const now = this.now();
      const rows = await this.deps.db
        .select()
        .from(notifications)
        .where(
          and(
            eq(notifications.status, "failed"),
            eq(notifications.retryable, true),
            gte(notifications.createdAt, now - RETRY_WINDOW_MS),
          ),
        )
        .orderBy(notifications.createdAt)
        .limit(RETRY_BATCH);
      const configs = new Map<string, SiteConfig | null>();
      for (const row of rows) {
        await this.retryOne(row, configs).catch((err: unknown) => warn("retry", err));
      }
    })().catch((err: unknown) => warn("retry_scan", err));
    if (this.deps.waitUntil) this.deps.waitUntil(run);
    else await run;
  }

  private async retryOne(
    row: typeof notifications.$inferSelect,
    configs: Map<string, SiteConfig | null>,
  ): Promise<void> {
    const { db } = this.deps;
    const key = rowKey(row.site, row.incidentId, row.kind, row.channel);
    const giveUp = (error: string) => this.record(key, final(error), row.attempts);
    const [incidentRow] = await db
      .select()
      .from(incidents)
      .where(and(eq(incidents.site, row.site), eq(incidents.id, row.incidentId)))
      .limit(1);
    if (!incidentRow) return giveUp("incident_gone");
    const incident = rowToIncident(incidentRow);
    if (!configs.has(row.site))
      configs.set(row.site, (await this.deps.configs.current(row.site))?.config ?? null);
    const config = configs.get(row.site) ?? null;
    const channel = siteChannels(config).find((c) => c.id === row.channel);
    if (!channel?.enabled) return giveUp("channel_gone");
    if (row.kind === "open" && incident.endedAt !== null) return giveUp("superseded");
    // Claim the retry: a concurrent run that got here first changed the row.
    const claimed = await db
      .update(notifications)
      .set({ status: "pending" })
      .where(and(key, eq(notifications.status, "failed"), eq(notifications.attempts, row.attempts)))
      .returning({ id: notifications.incidentId });
    if (claimed.length === 0) return;
    const now = this.now();
    const built = await this.build(row.site, config, row.kind, incident, now);
    const outcome = built.ok ? await sendVia(built.message, channel, this.context()) : final(built.error);
    await this.record(key, outcome, row.attempts + (built.ok ? 1 : 0));
    logOutcome(row.kind, eventOf(row.kind, incident), channel, outcome, row.attempts + 1, true);
  }

  private async record(
    key: ReturnType<typeof rowKey>,
    outcome: DeliveryOutcome,
    attempts: number,
  ): Promise<void> {
    const now = this.now();
    await this.deps.db
      .update(notifications)
      .set(
        outcome.ok
          ? { status: "sent", sentAt: now, error: null, attempts, retryable: false, lastAttemptAt: now }
          : {
              status: "failed",
              sentAt: null,
              error: outcome.error,
              attempts,
              retryable: outcome.retryable,
              lastAttemptAt: attempts > 0 ? now : null,
            },
      )
      .where(key);
  }

  /** The message of one transition, from the database as it is now. */
  private async build(
    site: string,
    config: SiteConfig | null,
    kind: NotificationKind,
    incident: Incident,
    now: number,
  ): Promise<Built> {
    const { db } = this.deps;
    const pageUrl = pageUrlOf(config);
    const siteName = config?.name ?? site;
    let message: AlertMessage | null;
    if (incident.kind === "down") {
      const service = await cardService(db, config, site, incident.serviceId);
      if (!service) return { ok: false, error: "unknown_service" };
      message =
        kind === "resolve"
          ? upMessage({ site, siteName, incident, service, pageUrl, now })
          : downMessage({
              site,
              siteName,
              incident,
              service,
              reason: await downReason(db, site, incident),
              pageUrl,
              now,
            });
    } else {
      const list = await siteSources(db, site);
      if (kind === "open") {
        message = staleMessage({ site, siteName, incident, sources: list, pageUrl, now });
      } else {
        const source = list.find((s) => s.id === incident.sourceId);
        if (!source) return { ok: false, error: "unknown_source" };
        const backfilled = await backfilledBeats(db, site, incident, source);
        message = recoveredMessage({ site, siteName, incident, source, backfilled, pageUrl, now });
      }
    }
    return validated(message);
  }

  private context(): ProviderContext {
    return providerContext(this.deps);
  }

  private retryOptions() {
    return this.deps.sleep ? { sleep: this.deps.sleep } : {};
  }

  private now() {
    return this.deps.now?.() ?? Date.now();
  }
}

/** The name the notifier had before it sent `down` cards. */
export { IncidentNotifier as StaleNotifier };

const final = (error: string): DeliveryOutcome => ({ ok: false, status: 0, error, retryable: false });

const rowKey = (site: string, incidentId: string, kind: NotificationKind, channel: string) =>
  and(
    eq(notifications.site, site),
    eq(notifications.incidentId, incidentId),
    eq(notifications.kind, kind),
    eq(notifications.channel, channel),
  )!;

/** A message every channel may see, or `invalid_message` (an address or a token slipped into a text). */
function validated(message: AlertMessage): Built {
  const parsed = AlertMessage.safeParse(message);
  return parsed.success ? { ok: true, message: parsed.data } : { ok: false, error: "invalid_message" };
}

function logOutcome(
  kind: NotificationKind,
  event: NotifyEvent,
  channel: ChannelConfig,
  outcome: DeliveryOutcome,
  attempts: number,
  retry = false,
) {
  console.log(
    JSON.stringify({
      evt: "notify",
      kind,
      event,
      channel: channel.id,
      type: channel.type,
      sent: outcome.ok,
      attempts,
      ...(retry ? { retry: true } : {}),
      ...(outcome.ok ? {} : { error: outcome.error }),
    }),
  );
}

/** What a provider may use: the notifier's secrets, sender, fetch and clock. */
function providerContext(deps: Pick<NotifierDeps, "secret" | "email" | "emailFrom" | "fetch" | "now">) {
  const doFetch = deps.fetch;
  return {
    secret: (name: string) => deps.secret(name),
    email: deps.email ?? null,
    emailFrom: deps.emailFrom,
    fetch: (doFetch ?? ((input, init) => fetch(input, init))) as typeof fetch,
    version: pkg.version,
    now: () => deps.now?.() ?? Date.now(),
  } satisfies ProviderContext;
}

/** `https://<first hostname>/` of the site's config, or null. */
const pageUrlOf = (config: Pick<SiteConfig, "hostnames"> | null) => {
  const host = config?.hostnames[0];
  return host ? `https://${host}/` : null;
};

/** A service of the site as the messages show it (display name applied), or null when unknown. */
async function cardService(
  db: Db,
  config: SiteConfig | null,
  site: string,
  serviceId: string | null,
): Promise<CardService | null> {
  if (!serviceId) return null;
  const [row] = await db
    .select()
    .from(services)
    .where(and(eq(services.site, site), eq(services.id, serviceId)))
    .limit(1);
  if (!row) return null;
  const s = rowToService(row);
  return {
    id: s.id,
    source: s.source,
    targetDisplay: s.targetDisplay,
    name: config?.displayNames[s.id] ?? s.name,
  };
}

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
 * The notifier for a platform: channel secrets through `notifySecret`, email through the platform's
 * sender, sends in its `waitUntil`. `now` is the clock the messages measure ages against (the cron passes
 * its scheduled time, the clock its sweep used).
 */
export function incidentNotifier(
  platform: Pick<Platform, "db" | "notifySecret" | "email" | "setting" | "waitUntil">,
  configs: ConfigSource,
  opts: { now?: () => number } = {},
): IncidentNotifier {
  const emailFrom = platform.setting("EMAIL_FROM");
  return new IncidentNotifier({
    db: platform.db,
    configs,
    secret: (name) => platform.notifySecret(name),
    email: platform.email,
    ...(emailFrom ? { emailFrom } : {}),
    waitUntil: (p: Promise<unknown>) => platform.waitUntil(p),
    ...(opts.now ? { now: opts.now } : {}),
  });
}

/** The name the factory had before the notifier sent `down` cards. */
export const staleNotifier = incidentNotifier;

export type TestCardKind = "stale" | "recovered" | "down" | "up";
export const TEST_CARD_KINDS: readonly TestCardKind[] = ["stale", "recovered", "down", "up"];

export type TestDeps = Omit<NotifierDeps, "waitUntil">;

export type TestCardResult =
  | { ok: true; source: string; service?: string; channel: string | null; outcome: DeliveryOutcome }
  | { ok: false; error: "no_source" | "no_service" | "no_channel" };

/** A test answers while the admin waits: one retry at most (a real delivery gets three attempts). */
const TEST_ATTEMPTS = 2;

/** How long the outage on a test `up` message lasts. */
const TEST_OUTAGE_MS = 10 * 60_000;

type TestMessage =
  | { ok: true; source: string; service?: string; message: AlertMessage }
  | { ok: false; error: "no_source" | "no_service" };

/**
 * A test `down` or `up` message for one of the site's services (`serviceId`, else its first monitor, else
 * its first service), from its current row and display name.
 */
async function serviceTestMessage(
  deps: TestDeps,
  config: SiteConfig | null,
  site: string,
  kind: "down" | "up",
  serviceId: string | undefined,
  now: number,
): Promise<TestMessage> {
  const rows = (
    await deps.db.select().from(services).where(eq(services.site, site)).orderBy(services.id)
  ).map(rowToService);
  const s = serviceId
    ? rows.find((r) => r.id === serviceId)
    : (rows.find((r) => r.id.startsWith("probe:")) ?? rows[0]);
  if (!s) return { ok: false, error: "no_service" };
  const service: CardService = {
    id: s.id,
    source: s.source,
    targetDisplay: s.targetDisplay,
    name: config?.displayNames[s.id] ?? s.name,
  };
  const incident: Incident = {
    id: `test:${s.id}`,
    site,
    kind: "down",
    serviceId: s.id,
    sourceId: null,
    startedAt: toIso(kind === "up" ? now - TEST_OUTAGE_MS : now),
    endedAt: kind === "up" ? toIso(now) : null,
    title: `${s.name} down`,
    notes: null,
  };
  const base = { site, siteName: config?.name ?? site, incident, service, pageUrl: pageUrlOf(config), now };
  const message =
    kind === "up"
      ? upMessage({ ...base, test: true })
      : downMessage({ ...base, reason: "test card", test: true });
  return { ok: true, source: s.source, service: s.id, message };
}

/**
 * A test message built from the current state of one of the site's sources (`sourceId`, else the first
 * Kuma source, else the first one) or services, for showing the alerts without silencing a producer.
 */
async function testMessage(
  deps: TestDeps,
  config: SiteConfig | null,
  site: string,
  kind: TestCardKind,
  sourceId: string | undefined,
  serviceId: string | undefined,
  now: number,
): Promise<TestMessage> {
  if (kind === "down" || kind === "up") return serviceTestMessage(deps, config, site, kind, serviceId, now);
  const list = await siteSources(deps.db, site);
  const source = sourceId
    ? list.find((s) => s.id === sourceId)
    : (list.find((s) => s.kind === "kuma") ?? list[0]);
  if (!source) return { ok: false, error: "no_source" };
  const common = { site, siteName: config?.name ?? site, pageUrl: pageUrlOf(config), now, test: true };
  if (kind === "stale") {
    const incident = testIncident(site, source, toIso(now), null);
    return { ok: true, source: source.id, message: staleMessage({ ...common, incident, sources: list }) };
  }
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
  return {
    ok: true,
    source: source.id,
    message: recoveredMessage({ ...common, incident, source, backfilled }),
  };
}

/** The historical Discord channel, for the test without a `channel` (always on `DISCORD_WEBHOOK_URL`). */
const LEGACY_TEST_CHANNEL: ChannelConfig = {
  id: LEGACY_DISCORD_CHANNEL,
  name: "Discord",
  type: "discord",
  secret: LEGACY_DISCORD_SECRET,
  events: ["down", "up", "stale", "recovered"],
  services: [],
  enabled: true,
};

/**
 * Sends a message labelled TEST, built from the site's current state, through a provider: to the channel
 * `channelId` of the site (any of `channelsOf`, disabled ones included), or without one to the historical
 * Discord webhook. Recorded nowhere: it belongs to no incident. A retryable failure is retried once.
 */
export async function sendTestCard(
  deps: TestDeps,
  site: string,
  kind: TestCardKind,
  sourceId?: string,
  serviceId?: string,
  channelId?: string,
): Promise<TestCardResult> {
  const now = deps.now?.() ?? Date.now();
  const config = (await deps.configs.current(site))?.config ?? null;
  let channel = LEGACY_TEST_CHANNEL;
  if (channelId !== undefined) {
    const found = siteChannels(config).find((c) => c.id === channelId);
    if (!found) return { ok: false, error: "no_channel" };
    channel = found;
  }
  const built = await testMessage(deps, config, site, kind, sourceId, serviceId, now);
  if (!built.ok) return built;
  const valid = validated(built.message);
  const { outcome } = valid.ok
    ? await sendWithRetries(() => sendVia(valid.message, channel, providerContext(deps)), {
        maxAttempts: TEST_ATTEMPTS,
        ...(deps.sleep ? { sleep: deps.sleep } : {}),
      })
    : { outcome: final("forbidden_literal") };
  return {
    ok: true,
    source: built.source,
    ...(built.service ? { service: built.service } : {}),
    channel: channelId ?? null,
    outcome,
  };
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
