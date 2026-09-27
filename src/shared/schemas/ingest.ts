import { z } from "zod";
import {
  ExternalId,
  HostLabel,
  IsoTimestamp,
  Milliseconds,
  Ratio,
  ServiceKind,
  ServiceStatus,
  ShortMessage,
  SiteSlug,
  SourceId,
} from "../model/common";
import {
  Fact,
  FactGroup,
  FactKey,
  FactSeverity,
  FactUnit,
  FactValueType,
  factValueFrom,
} from "../model/fact";
import { Heartbeat } from "../model/heartbeat";
import { safeDisplay } from "../model/safety";
import { CertSummary, Service } from "../model/service";

/**
 * Ingest BODY schemas (HMAC headers are verified before these run). Only fields the adapters read are
 * declared; unknown keys are stripped. Array and string caps keep a body well under the 256 KB limit.
 */
export const INGEST_LIMITS = {
  monitors: 200,
  heartbeats: 2000,
  importantHeartbeats: 1000,
  kumaMessage: 500,
  url: 2048,
  factGroups: 32,
  factsPerGroup: 64,
  eventServices: 200,
  eventHeartbeats: 1000,
  eventFacts: 500,
  /** 30 days. */
  maxFreshForS: 30 * 24 * 3600,
} as const;

/* ------------------------------------------------------------------ */
/* Kuma collector snapshot (POST /api/ingest/kuma)                     */
/* ------------------------------------------------------------------ */

/** Kuma heartbeat status codes and their model status. */
export const KUMA_STATUS = { 0: "down", 1: "up", 2: "pending", 3: "maintenance" } as const satisfies Record<
  number,
  ServiceStatus
>;
export const KumaStatusCode = z.literal([0, 1, 2, 3]);
export type KumaStatusCode = z.infer<typeof KumaStatusCode>;

export const kumaStatusToServiceStatus = (code: KumaStatusCode): ServiceStatus => KUMA_STATUS[code];

const KumaMonitorId = z.number().int().positive();
/** JSON object keys for per-monitor maps are the monitor id as a decimal string. */
const KumaMonitorKey = z.string().regex(/^[1-9]\d{0,8}$/);

const monitorMap = <T extends z.ZodType>(value: T) =>
  z.record(KumaMonitorKey, value).refine((r) => Object.keys(r).length <= INGEST_LIMITS.monitors, {
    message: `At most ${INGEST_LIMITS.monitors} monitors`,
  });

/**
 * A Kuma heartbeat. `msg` is raw Kuma text and may contain an address (e.g. a connection error), so it is
 * NOT display-safe here: the adapter passes it through `scrubForbiddenLiterals` before it becomes a
 * model `Heartbeat.message`.
 */
export const KumaBeat = z.object({
  monitorId: KumaMonitorId,
  ts: IsoTimestamp,
  status: KumaStatusCode,
  pingMs: Milliseconds.nullable(),
  msg: z.string().max(INGEST_LIMITS.kumaMessage).nullable(),
  important: z.boolean().optional(),
});
export type KumaBeat = z.infer<typeof KumaBeat>;

/** Monitor config as the collector sends it, after mapping tailnet addresses to hostnames. */
export const KumaMonitor = z.object({
  id: KumaMonitorId,
  name: safeDisplay(150),
  /** Raw Kuma type (`http`, `port`, `ping`, `keyword`, `push`, `docker`, ...); the adapter maps it. */
  type: z.string().regex(/^[a-z0-9-]{1,32}$/),
  url: safeDisplay(INGEST_LIMITS.url).nullable(),
  hostname: safeDisplay(253).nullable(),
  port: z.number().int().min(1).max(65535).nullable(),
  method: z
    .string()
    .regex(/^[A-Z]{1,10}$/)
    .nullable(),
  intervalS: z.number().int().positive(),
  timeoutS: z.number().nonnegative().nullable(),
  active: z.boolean(),
});
export type KumaMonitor = z.infer<typeof KumaMonitor>;

const VersionString = z.string().regex(/^[0-9A-Za-z.+-]{1,32}$/);

export const KumaInfo = z.object({
  version: VersionString.nullable(),
  latestVersion: VersionString.nullable(),
  dbSizeBytes: z.number().int().nonnegative().nullable(),
  /** e.g. `Asia/Tokyo (+09:00)`. */
  timezone: safeDisplay(64).nullable(),
});
export type KumaInfo = z.infer<typeof KumaInfo>;

export const KumaUptime = z.object({ h24: Ratio.nullable(), d30: Ratio.nullable() });
export type KumaUptime = z.infer<typeof KumaUptime>;

export const KumaSnapshot = z
  .object({
    v: z.literal(1),
    generatedAt: IsoTimestamp,
    /** Collector host label, e.g. `watch-1`. */
    host: HostLabel,
    /** False when Kuma is down or login failed; the page then says "Kuma down", not "collector down". */
    reachable: z.boolean(),
    error: safeDisplay(500).optional(),
    kuma: KumaInfo,
    monitors: z.array(KumaMonitor).max(INGEST_LIMITS.monitors),
    /** Only beats newer than the last acknowledged timestamp. */
    heartbeatsSince: z.array(KumaBeat).max(INGEST_LIMITS.heartbeats),
    importantHeartbeats: z.array(KumaBeat).max(INGEST_LIMITS.importantHeartbeats),
    uptime: monitorMap(KumaUptime),
    /** 24 h average ping in ms. */
    avgPing: monitorMap(Milliseconds.nullable()),
    certInfo: monitorMap(CertSummary.nullable()),
  })
  .superRefine((snap, ctx) => {
    const ids = new Set<number>();
    for (const [i, m] of snap.monitors.entries()) {
      if (ids.has(m.id))
        ctx.addIssue({ code: "custom", message: "Duplicate monitor id", path: ["monitors", i, "id"] });
      ids.add(m.id);
    }
    const checkBeats = (key: "heartbeatsSince" | "importantHeartbeats") => {
      for (const [i, b] of snap[key].entries()) {
        if (!ids.has(b.monitorId)) {
          ctx.addIssue({ code: "custom", message: "Unknown monitorId", path: [key, i, "monitorId"] });
        }
      }
    };
    checkBeats("heartbeatsSince");
    checkBeats("importantHeartbeats");
    for (const key of ["uptime", "avgPing", "certInfo"] as const) {
      for (const k of Object.keys(snap[key])) {
        if (!ids.has(Number(k)))
          ctx.addIssue({ code: "custom", message: "Unknown monitor id", path: [key, k] });
      }
    }
  });
export type KumaSnapshot = z.infer<typeof KumaSnapshot>;

/* ------------------------------------------------------------------ */
/* Facts (POST /api/ingest/facts)                                      */
/* ------------------------------------------------------------------ */

const rawFactShape = {
  key: FactKey,
  /** String values are shown in the UI, so they must be display-safe. */
  value: z.union([z.number(), z.boolean(), safeDisplay(500)]),
  /** Only needed for `timestamp` (a string that should be typed as a time). */
  type: FactValueType.optional(),
  unit: FactUnit.optional(),
  severity: FactSeverity.optional(),
  freshForS: z.number().int().positive().max(INGEST_LIMITS.maxFreshForS),
  /** Defaults to the payload's generatedAt. */
  observedAt: IsoTimestamp.optional(),
};

const valueMatchesType = (f: { value: number | boolean | string; type?: FactValueType }) =>
  factValueFrom(f.value, f.type) !== null;
const typeMismatch = { message: "Value does not match its type", path: ["value"] };

export const IngestFact = z.object(rawFactShape).refine(valueMatchesType, typeMismatch);
export type IngestFact = z.infer<typeof IngestFact>;

export const FactsPayload = z
  .object({
    v: z.literal(1),
    generatedAt: IsoTimestamp,
    /** Producing host label, e.g. `app-1`. */
    producer: HostLabel,
    groups: z
      .array(
        z.object({
          group: FactGroup,
          facts: z.array(IngestFact).min(1).max(INGEST_LIMITS.factsPerGroup),
        }),
      )
      .max(INGEST_LIMITS.factGroups),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    for (const [gi, g] of p.groups.entries()) {
      for (const [fi, f] of g.facts.entries()) {
        const k = `${g.group}/${f.key}`;
        if (seen.has(k)) {
          ctx.addIssue({
            code: "custom",
            message: `Duplicate fact ${k}`,
            path: ["groups", gi, "facts", fi, "key"],
          });
        }
        seen.add(k);
      }
    }
  });
export type FactsPayload = z.infer<typeof FactsPayload>;

/* ------------------------------------------------------------------ */
/* Generic events (POST /api/ingest/events)                            */
/* ------------------------------------------------------------------ */

/** Declares or updates a service owned by the webhook source. */
export const EventService = z.object({
  externalId: ExternalId,
  name: safeDisplay(150),
  kind: ServiceKind,
  targetDisplay: safeDisplay(300).nullable().optional(),
  intervalS: z.number().int().positive().optional(),
});
export type EventService = z.infer<typeof EventService>;

export const EventHeartbeat = z.object({
  externalId: ExternalId,
  ts: IsoTimestamp,
  status: ServiceStatus,
  latencyMs: Milliseconds.nullable().optional(),
  message: ShortMessage.nullable().optional(),
});
export type EventHeartbeat = z.infer<typeof EventHeartbeat>;

export const EventFact = z
  .object({ group: FactGroup, ...rawFactShape })
  .refine(valueMatchesType, typeMismatch);
export type EventFact = z.infer<typeof EventFact>;

export const EventsPayload = z
  .object({
    v: z.literal(1),
    generatedAt: IsoTimestamp,
    producer: HostLabel,
    services: z.array(EventService).max(INGEST_LIMITS.eventServices).optional(),
    heartbeats: z.array(EventHeartbeat).max(INGEST_LIMITS.eventHeartbeats).optional(),
    facts: z.array(EventFact).max(INGEST_LIMITS.eventFacts).optional(),
  })
  .refine((p) => (p.heartbeats?.length ?? 0) + (p.facts?.length ?? 0) + (p.services?.length ?? 0) > 0, {
    message: "Send at least one service, heartbeat or fact",
  });
export type EventsPayload = z.infer<typeof EventsPayload>;

/* ------------------------------------------------------------------ */
/* ModelDelta: what every adapter's normalize() returns (Phase 1)       */
/* ------------------------------------------------------------------ */

/** Marks the source as seen; `ok` false (e.g. Kuma unreachable) keeps lastOkAt where it was. */
export const SourceTouch = z.object({
  sourceId: SourceId,
  seenAt: IsoTimestamp,
  ok: z.boolean(),
  error: safeDisplay(500).nullable(),
});
export type SourceTouch = z.infer<typeof SourceTouch>;

export const ModelDelta = z.object({
  site: SiteSlug,
  /** The payload's generatedAt; older than the last accepted never overwrites `latest:<site>`. */
  generatedAt: IsoTimestamp,
  source: SourceTouch,
  /** Full service rows to upsert (current state). */
  services: z.array(Service),
  /** New heartbeats, idempotent on (serviceId, ts). */
  heartbeats: z.array(Heartbeat),
  /** Current fact values to upsert on (site, group, key). */
  facts: z.array(Fact),
});
export type ModelDelta = z.infer<typeof ModelDelta>;
