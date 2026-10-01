/**
 * Admin API contract (Phase 3, frozen): request and response bodies of `/api/admin/*`. Every route needs a
 * signed-in user with the route's permission (src/shared/auth.ts: `config.edit` for config, `sources.manage`
 * for sources and keys); 401 signed out, 403 without it. Responses carry no secrets except the one-time
 * `secret` of a created or rotated ingest key and the one-time `url` of a created or rotated push URL.
 *
 * Routes (all JSON unless noted; `:site` is a site slug):
 * - `POST   /api/admin/sites`                               CreateSiteRequest -> 201 SaveConfigResponse (`instance.manage`; 409 when the slug exists)
 * - `GET    /api/admin/sites/:site/config`                  -> ConfigState
 * - `PUT    /api/admin/sites/:site/config`                  SaveConfigRequest -> SaveConfigResponse (409 on a stale `baseVersion`, 400 with `issues`)
 * - `GET    /api/admin/sites/:site/config/export`           -> the `sites/<slug>.json` text (`exportSiteConfig`), `content-disposition: attachment`
 * - `POST   /api/admin/sites/:site/config/import?dryRun=1`  body: the file text -> ImportResult (with `dryRun=1` nothing is saved)
 * - `GET    /api/admin/sites/:site/config/revisions`        -> RevisionList
 * - `POST   /api/admin/sites/:site/config/revisions/:version/restore` -> SaveConfigResponse (restoring saves a new revision)
 * - `GET    /api/admin/sites/:site/sources`                 -> SourceKeyList (every key of the site, `inConfig` per key)
 * - `POST   /api/admin/sites/:site/sources`                 CreateSourceRequest -> IssuedKey (source added to the config as a new revision)
 * - `POST   /api/admin/sites/:site/sources/:keyId/rotate`   -> IssuedKey (the new key is `next`; see KeyState)
 * - `GET    /api/admin/sites/:site/notifications?limit=50`  -> DeliveryList (`config.edit`; newest first, at most 200)
 * - `GET    /api/admin/sites/:site/push-tokens`             -> PushTokenList (contract addition; `sources.manage`)
 * - `POST   /api/admin/sites/:site/monitors/:id/push-token` -> 201 IssuedPushUrl (contract addition; `sources.manage`; creates or rotates)
 */
import { z } from "zod";
import { SiteConfig } from "../config";
import { SourceId, SourceKind } from "../model";

/** A key id: lower-case, digits and `-` (e.g. `collector-1`, `facts-1`), bound to one site and one source. */
export const KeyId = z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/);
export type KeyId = z.infer<typeof KeyId>;

/** One field-level difference between two configs; `path` is dotted with array indexes (`sections.1.title`). */
export const ConfigDiffEntry = z.object({
  path: z.string(),
  op: z.enum(["add", "remove", "change"]),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
});
export type ConfigDiffEntry = z.infer<typeof ConfigDiffEntry>;

/** A Zod issue flattened for the editor: where and why. */
export const ConfigIssue = z.object({ path: z.string(), message: z.string() });
export type ConfigIssue = z.infer<typeof ConfigIssue>;

export const ConfigState = z.object({
  config: SiteConfig,
  /** Monotonic per site; the seed from `sites/<slug>.json` is version 1. */
  version: z.number().int().positive(),
  savedAt: z.string(),
  /** Who saved it: `seed` for the committed file, `admin` for the editor (no personal data). */
  savedBy: z.string(),
});
export type ConfigState = z.infer<typeof ConfigState>;

export const SaveConfigRequest = z.object({
  /** The full config as the editor holds it (defaults may be omitted; the server applies them). */
  config: z.unknown(),
  /** The version the edit started from; a newer saved version makes this a 409. */
  baseVersion: z.number().int().positive(),
  /** Optional one-line note shown in the revision list. */
  note: z.string().max(200).optional(),
});
export type SaveConfigRequest = z.infer<typeof SaveConfigRequest>;

/** `POST /api/admin/sites`: a new site with `config` as its version 1 (201 `SaveConfigResponse`, 409 when taken). */
export const CreateSiteRequest = z.object({ config: SiteConfig });
export type CreateSiteRequest = z.infer<typeof CreateSiteRequest>;

export const SaveConfigResponse = z.object({
  version: z.number().int().positive(),
  diff: z.array(ConfigDiffEntry),
});
export type SaveConfigResponse = z.infer<typeof SaveConfigResponse>;

export const ConfigErrorResponse = z.object({
  /** `unavailable`: creating or rotating a key without SOURCE_MASTER_KEY configured (503). */
  error: z.enum(["invalid", "conflict", "not_found", "unavailable"]),
  message: z.string(),
  issues: z.array(ConfigIssue).default([]),
  /** On `conflict`: the version now saved. */
  currentVersion: z.number().int().positive().optional(),
});
export type ConfigErrorResponse = z.infer<typeof ConfigErrorResponse>;

export const ImportResult = z.object({
  valid: z.boolean(),
  issues: z.array(ConfigIssue),
  /** Against the current saved config (empty when identical). */
  diff: z.array(ConfigDiffEntry),
  /** Set when the import was saved (not a dry run, valid, and different). */
  version: z.number().int().positive().nullable(),
});
export type ImportResult = z.infer<typeof ImportResult>;

export const Revision = z.object({
  version: z.number().int().positive(),
  savedAt: z.string(),
  savedBy: z.string(),
  note: z.string().nullable(),
  /** Number of changed fields against the previous revision. */
  changes: z.number().int().min(0),
});
export const RevisionList = z.object({ current: z.number().int().positive(), revisions: z.array(Revision) });
export type RevisionList = z.infer<typeof RevisionList>;

/**
 * Rotation: `rotate` issues a `next` key; ingest accepts `current` and `next`; the first request that verifies
 * with `next` promotes it to `current` and drops the old one. `lastUsedAt` is set on successful ingest.
 */
export const KeyState = z.object({
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export const SourceKey = z.object({
  keyId: KeyId,
  source: SourceId,
  kind: SourceKind,
  /**
   * Where the key lives: always `d1` (sealed with SOURCE_MASTER_KEY). Kept for API compatibility; `env`
   * (the `INGEST_KEY_*` Worker secrets) is gone.
   */
  store: z.literal("d1"),
  current: KeyState.nullable(),
  next: KeyState.nullable(),
  /**
   * Contract addition: whether the site still watches the key's source (`siteSources`). False for a source
   * removed from the config (retired): the key stays listed and rotatable, since hiding it would hide a
   * credential that still verifies.
   */
  inConfig: z.boolean(),
});
export type SourceKey = z.infer<typeof SourceKey>;
export const SourceKeyList = z.object({ keys: z.array(SourceKey) });
export type SourceKeyList = z.infer<typeof SourceKeyList>;

export const CreateSourceRequest = z.object({
  keyId: KeyId,
  source: SourceId,
  kind: SourceKind,
  expectedIntervalS: z.number().int().positive(),
});
export type CreateSourceRequest = z.infer<typeof CreateSourceRequest>;

/** The only response that carries a secret; shown once, never retrievable again. */
export const IssuedKey = z.object({
  keyId: KeyId,
  source: SourceId,
  secret: z.string().min(32),
  slot: z.enum(["current", "next"]),
});
export type IssuedKey = z.infer<typeof IssuedKey>;

/**
 * `GET /api/admin/sites/:site/notifications?limit=50` (`config.edit`, like the notification test): the
 * site's recent deliveries, newest first, one row per (incident, kind, channel). Never a URL, token, address
 * or response body: `error` is the provider's short code only.
 */
export const DeliveryStatus = z.enum(["pending", "sent", "failed"]);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

export const Delivery = z.object({
  incidentId: z.string().min(1).max(200),
  /** The transition as the delivery log stores it (`open`, `resolve`). */
  kind: z.string().min(1).max(32),
  /** The channel id (`discord` for the historical channel and rows older than channels). */
  channel: z.string().min(1).max(64),
  status: DeliveryStatus,
  attempts: z.number().int().min(0),
  /** Whether a failed delivery will be retried (null while pending or once sent). */
  retryable: z.boolean().nullable(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
  lastAttemptAt: z.string().nullable(),
  /** A short error code (`http_404`, `timeout`, `email_unavailable`), null unless failed. */
  error: z.string().max(64).nullable(),
  /**
   * What the incident was about: a `service` (down) or a `source` (stale); absent once the incident is
   * past retention. Lets admin word an alert whose service or source was removed since.
   */
  subject: z.enum(["service", "source"]).optional(),
});
export type Delivery = z.infer<typeof Delivery>;

export const DeliveryList = z.object({ deliveries: z.array(Delivery) });
export type DeliveryList = z.infer<typeof DeliveryList>;

/** Deliveries per page: default and maximum of `limit`. */
export const DELIVERY_LIMIT = { default: 50, max: 200 } as const;

/**
 * `POST /api/admin/notify/test?site=&channel=&kind=`: the result of one TEST message to one channel (200 when
 * sent, 502 when the channel did not take it, with the same body).
 */
export const NotifyTestResult = z.object({
  sent: z.boolean(),
  status: z.number().int(),
  error: z.string().nullable(),
  channel: z.string().optional(),
});
export type NotifyTestResult = z.infer<typeof NotifyTestResult>;

/**
 * `GET /api/admin/sites/:site/push-tokens` (`sources.manage`): the push URL of each push monitor of the
 * current config. Never the token or its hash: only whether one exists, when it was created and when its
 * last push arrived.
 */
export const PushTokenSummary = z.object({
  monitorId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  hasUrl: z.boolean(),
  createdAt: z.string().nullable(),
  lastPushAt: z.string().nullable(),
});
export type PushTokenSummary = z.infer<typeof PushTokenSummary>;
export const PushTokenList = z.object({ monitors: z.array(PushTokenSummary) });
export type PushTokenList = z.infer<typeof PushTokenList>;

/**
 * `POST /api/admin/sites/:site/monitors/:id/push-token` (`sources.manage`): a new push URL for a push
 * monitor of the saved config (201). Creating one again rotates it: the old URL stops at once. The only
 * response that carries the token (inside `url`); shown once, never retrievable again.
 */
export const IssuedPushUrl = z.object({
  monitorId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/),
  url: z.url({ protocol: /^https?$/ }),
  createdAt: z.string(),
  /** True when an earlier URL existed and has stopped working. */
  rotated: z.boolean(),
});
export type IssuedPushUrl = z.infer<typeof IssuedPushUrl>;
