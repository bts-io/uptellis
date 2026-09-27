import { z } from "zod";
import {
  ExternalId,
  IsoTimestamp,
  Milliseconds,
  Ratio,
  ServiceId,
  ServiceKind,
  ServiceStatus,
  SiteSlug,
  SourceId,
  sourceKindOf,
} from "./common";
import { safeDisplay } from "./safety";

export const CertSummary = z.object({
  valid: z.boolean(),
  cn: safeDisplay(253).nullable(),
  issuer: safeDisplay(200).nullable(),
  validTo: IsoTimestamp,
  daysRemaining: z.number().int(),
});
export type CertSummary = z.infer<typeof CertSummary>;

/** A monitored thing (Kuma monitor, probe, webhook service). `id` is `<kind of source>:<externalId>`. */
export const Service = z
  .object({
    id: ServiceId,
    site: SiteSlug,
    source: SourceId,
    externalId: ExternalId,
    name: safeDisplay(150),
    kind: ServiceKind,
    /** Host + path or `host:port`; never an address literal. Null for push and fact services. */
    targetDisplay: safeDisplay(300).nullable(),
    intervalS: z.number().int().positive().nullable(),
    /** HTTP method for http and keyword checks (Kuma `method`); absent for other kinds. */
    method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).optional(),
    /** Per-check timeout in seconds, when the source reports one. */
    timeoutS: z.number().positive().optional(),
    status: ServiceStatus,
    /** Latency of the most recent check. */
    latencyMs: Milliseconds.nullable(),
    /** 24 h average latency (Kuma avgPing). */
    avgLatencyMs: Milliseconds.nullable(),
    uptime24h: Ratio.nullable(),
    uptime30d: Ratio.nullable(),
    cert: CertSummary.optional(),
  })
  .refine((s) => s.id === `${sourceKindOf(s.source)}:${s.externalId}`, {
    message: "Service id must be <source kind>:<externalId>",
    path: ["id"],
  });
export type Service = z.infer<typeof Service>;
