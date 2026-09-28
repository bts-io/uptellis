/**
 * API keys for pushers and agents (`api_keys`). A key is bound to one site and a set of scopes
 * (`API_KEY_SCOPES`: `ingest`, `read`) and is sent as `Authorization: Bearer <key>`.
 *
 * The key is `upt_<id>_<secret>`: `id` (12 lower-case letters and digits) finds the row, `secret` (32 random
 * bytes, base64url) proves possession. Only the SHA-256 of the secret is stored; the whole key is returned
 * once, when it is created. A revoked key stays listed (with `revokedAt`) and never verifies again.
 * `lastUsedAt` is written at most once a minute per key.
 */
import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import type { ApiKeyScope } from "@/shared/auth";
import type { ApiKeySummary, IssuedApiKey } from "@/shared/schemas/auth";
import { apiKeys } from "../db/schema";
import { toIso } from "../db/util";
import type { AuthPlatform } from "./instance";
import { constantTimeEqual, hashToken, randomId, randomToken } from "./tokens";

const KEY_RE = /^upt_([a-z0-9]{12})_([A-Za-z0-9_-]{43})$/;

/** `lastUsedAt` is written at most this often per key. */
export const API_KEY_TOUCH_MS = 60_000;

type Row = typeof apiKeys.$inferSelect;

export interface VerifiedApiKey {
  id: string;
  site: string;
  scopes: readonly ApiKeyScope[];
}

const summary = (r: Row): ApiKeySummary => ({
  id: r.id,
  site: r.site,
  name: r.name,
  scopes: r.scopes,
  prefix: `upt_${r.id}`,
  createdAt: toIso(r.createdAt),
  createdBy: r.createdBy,
  lastUsedAt: r.lastUsedAt === null ? null : toIso(r.lastUsedAt),
  revokedAt: r.revokedAt === null ? null : toIso(r.revokedAt),
});

export async function listApiKeys(p: AuthPlatform, site: string): Promise<ApiKeySummary[]> {
  const rows = await p.db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.site, site))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map(summary);
}

export async function issueApiKey(
  p: AuthPlatform,
  input: { site: string; name: string; scopes: ApiKeyScope[]; createdBy: string | null },
): Promise<IssuedApiKey> {
  const id = randomId();
  const secret = randomToken();
  const [row] = await p.db
    .insert(apiKeys)
    .values({
      id,
      site: input.site,
      name: input.name,
      scopes: input.scopes,
      secretHash: await hashToken(secret),
      createdBy: input.createdBy,
      createdAt: p.now(),
    })
    .returning();
  return { ...summary(row!), key: `upt_${id}_${secret}` };
}

/** Revokes a key of `site`; null when the site has no such key. Revoking twice keeps the first time. */
export async function revokeApiKey(p: AuthPlatform, site: string, id: string): Promise<ApiKeySummary | null> {
  const where = and(eq(apiKeys.id, id), eq(apiKeys.site, site));
  await p.db
    .update(apiKeys)
    .set({ revokedAt: p.now() })
    .where(and(where, isNull(apiKeys.revokedAt)));
  const [row] = await p.db.select().from(apiKeys).where(where);
  return row ? summary(row) : null;
}

/** The `Authorization: Bearer` token of a request, or null. */
export function bearerToken(request: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") ?? "");
  return m ? m[1]! : null;
}

/** True when `token` has the shape of an API key (it may still be unknown or revoked). */
export const isApiKey = (token: string) => KEY_RE.test(token);

/** The key's binding when `token` is a known, unrevoked key with the right secret; else null. */
export async function verifyApiKey(p: AuthPlatform, token: string): Promise<VerifiedApiKey | null> {
  const m = KEY_RE.exec(token);
  if (!m) return null;
  const [, id, secret] = m;
  const [row] = await p.db.select().from(apiKeys).where(eq(apiKeys.id, id!));
  if (!row || row.revokedAt !== null) return null;
  if (!(await constantTimeEqual(await hashToken(secret!), row.secretHash))) return null;
  return { id: row.id, site: row.site, scopes: row.scopes };
}

/** Records a use of the key (best effort, at most once a minute). */
export async function touchApiKey(p: AuthPlatform, id: string): Promise<void> {
  const now = p.now();
  await p.db
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(
      and(eq(apiKeys.id, id), or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, now - API_KEY_TOUCH_MS))),
    );
}
