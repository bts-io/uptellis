/**
 * Admin API contract (Phase 3, frozen): request and response bodies of `/api/admin/*`. Every route sits behind
 * the admin gate (`ADMIN_KEY`: `?admin=<key>` once sets a signed 30-day `uptellis_admin` cookie; without it `/admin`
 * and `/api/admin/*` answer 404). Responses carry no secrets except the one-time `secret` of a created or
 * rotated ingest key.
 *
 * Routes (all JSON unless noted; `:site` is a site slug):
 * - `GET    /api/admin/sites/:site/config`                  -> ConfigState
 * - `PUT    /api/admin/sites/:site/config`                  SaveConfigRequest -> SaveConfigResponse (409 on a stale `baseVersion`, 400 with `issues`)
 * - `GET    /api/admin/sites/:site/config/export`           -> the `sites/<slug>.json` text (`exportSiteConfig`), `content-disposition: attachment`
 * - `POST   /api/admin/sites/:site/config/import?dryRun=1`  body: the file text -> ImportResult (with `dryRun=1` nothing is saved)
 * - `GET    /api/admin/sites/:site/config/revisions`        -> RevisionList
 * - `POST   /api/admin/sites/:site/config/revisions/:version/restore` -> SaveConfigResponse (restoring saves a new revision)
 * - `GET    /api/admin/sites/:site/sources`                 -> SourceKeyList
 * - `POST   /api/admin/sites/:site/sources`                 CreateSourceRequest -> IssuedKey (source added to the config as a new revision)
 * - `POST   /api/admin/sites/:site/sources/:keyId/rotate`   -> IssuedKey (the new key is `next`; see KeyState)
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
  /** Where the key lives: `d1` (sealed with SOURCE_MASTER_KEY) or `env` (a legacy `INGEST_KEY_*` Worker secret). */
  store: z.enum(["d1", "env"]),
  current: KeyState.nullable(),
  next: KeyState.nullable(),
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
