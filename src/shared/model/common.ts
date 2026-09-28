import { z } from "zod";
import { safeDisplay } from "./safety";

/** UTC ISO 8601 timestamp with a `Z` suffix, e.g. `2026-09-27T23:58:00Z`. Every timestamp in the model. */
export const IsoTimestamp = z.iso.datetime();
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

/** Site slug, the key every persisted row carries. */
export const SiteSlug = z.string().regex(/^[a-z0-9-]{2,32}$/);
export type SiteSlug = z.infer<typeof SiteSlug>;

/** Fully qualified DNS hostname (lower case). The alphabetic TLD rules out IPv4 literals. */
export const Hostname = z
  .string()
  .max(253)
  .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, "Expected a lower-case DNS hostname");
export type Hostname = z.infer<typeof Hostname>;

/** Single-label host name such as `app-1` or `watch-1` (tailnet or machine name, never an address). */
export const HostLabel = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62})$/, "Expected a host label like app-1");
export type HostLabel = z.infer<typeof HostLabel>;

export const SOURCE_KINDS = ["kuma", "facts", "webhook", "probe"] as const;
export const SourceKind = z.enum(SOURCE_KINDS);
export type SourceKind = z.infer<typeof SourceKind>;

/** `<kind>:<name>`, e.g. `kuma:watch-1`, `facts:app-1`. */
export const SourceId = z.string().regex(/^(?:kuma|facts|webhook|probe):[a-z0-9][a-z0-9-]{0,31}$/);
export type SourceId = z.infer<typeof SourceId>;

/** The kind prefix of a source id (`kuma:watch-1` -> `kuma`). */
export const sourceKindOf = (id: SourceId): SourceKind => id.slice(0, id.indexOf(":")) as SourceKind;

/** The producer's own id for a service (Kuma monitor id, webhook service key). */
export const ExternalId = z.string().regex(/^[A-Za-z0-9._-]{1,64}$/);
export type ExternalId = z.infer<typeof ExternalId>;

/** Stable service id `<sourceKind>:<externalId>`, e.g. `kuma:3`. Unique within a site. */
export const ServiceId = z.string().regex(/^(?:kuma|facts|webhook|probe):[A-Za-z0-9._-]{1,64}$/);
export type ServiceId = z.infer<typeof ServiceId>;

export const serviceId = (kind: SourceKind, externalId: string | number): ServiceId =>
  `${kind}:${externalId}`;

export const SERVICE_STATUSES = [
  "up",
  "down",
  "degraded",
  "pending",
  "maintenance",
  "paused",
  "unknown",
] as const;
export const ServiceStatus = z.enum(SERVICE_STATUSES);
export type ServiceStatus = z.infer<typeof ServiceStatus>;

export const SERVICE_KINDS = ["http", "port", "ping", "keyword", "push", "fact", "tls"] as const;
export const ServiceKind = z.enum(SERVICE_KINDS);
export type ServiceKind = z.infer<typeof ServiceKind>;

/** 0 to 1 ratio (Kuma's uptime unit; the UI multiplies by 100). */
export const Ratio = z.number().min(0).max(1);

export const Milliseconds = z.number().nonnegative();

/** Short free text shown next to a value (heartbeat message, error). */
export const ShortMessage = safeDisplay(200);
