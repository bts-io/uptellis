/**
 * Push monitors in the SQL database (`push_tokens`, src/worker/db/schema/push.ts): their push tokens and the
 * clock of the silent rule. A token is 32 random bytes, base64url (43 characters), returned once when it is
 * issued; only its SHA-256 is stored, and a request is matched by that hash. Issuing again for the same
 * monitor replaces the hash, so the old token stops at once. Nothing here returns a hash or a token after
 * `issue`.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Platform } from "@/platform/types";
import type { PushTokenSummary } from "@/shared/schemas/admin";
import { schema } from "@/worker/db";
import { toIso } from "@/worker/db/util";
import { hashToken, randomToken } from "../auth/tokens";

const { pushTokens } = schema;

/** A push token as it appears in a push URL (`randomToken`: 43 base64url characters). */
export const PUSH_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** The push path of a token (`/api/push/<token>`), without the origin. */
export const pushPath = (token: string) => `/api/push/${token}`;

/** What the silent rule reads of a push monitor's row. Never the token hash. */
export interface PushWatch {
  monitorId: string;
  lastPushAt: number | null;
  watchSince: number | null;
  configVersion: number;
}

export class PushTokenStore {
  constructor(private readonly platform: Pick<Platform, "db">) {}

  /**
   * A new token for the site's push monitor: replaces any earlier one (which stops at once) and returns the
   * token, once. `configVersion` is the config version the monitor was checked against.
   */
  async issue(
    site: string,
    monitorId: string,
    configVersion: number,
    nowMs: number,
  ): Promise<{ token: string; rotated: boolean }> {
    const token = randomToken();
    const tokenHash = await hashToken(token);
    const [before] = await this.platform.db
      .select({ tokenHash: pushTokens.tokenHash })
      .from(pushTokens)
      .where(and(eq(pushTokens.site, site), eq(pushTokens.monitorId, monitorId)));
    await this.platform.db
      .insert(pushTokens)
      .values({ site, monitorId, tokenHash, tokenCreatedAt: nowMs, configVersion, createdAt: nowMs })
      .onConflictDoUpdate({
        target: [pushTokens.site, pushTokens.monitorId],
        set: {
          tokenHash,
          tokenCreatedAt: nowMs,
          configVersion: sql`max(${pushTokens.configVersion}, ${configVersion})`,
        },
      });
    return { token, rotated: !!before?.tokenHash };
  }

  /** The site and monitor of a token, or null for an unknown or rotated one. */
  async lookup(token: string): Promise<{ site: string; monitorId: string } | null> {
    if (!PUSH_TOKEN_RE.test(token)) return null;
    const tokenHash = await hashToken(token);
    const [row] = await this.platform.db
      .select({ site: pushTokens.site, monitorId: pushTokens.monitorId })
      .from(pushTokens)
      .where(eq(pushTokens.tokenHash, tokenHash));
    return row ?? null;
  }

  /** Records an accepted push (`lastPushAt` never moves backwards). */
  async recordPush(site: string, monitorId: string, nowMs: number): Promise<void> {
    await this.platform.db
      .update(pushTokens)
      .set({ lastPushAt: sql`max(coalesce(${pushTokens.lastPushAt}, 0), ${nowMs})` })
      .where(and(eq(pushTokens.site, site), eq(pushTokens.monitorId, monitorId)));
  }

  /** The site's push monitors with a row (the admin listing): never a token or its hash. */
  async list(site: string): Promise<PushTokenSummary[]> {
    const rows = await this.platform.db
      .select({
        monitorId: pushTokens.monitorId,
        hasUrl: sql<number>`${pushTokens.tokenHash} is not null`,
        tokenCreatedAt: pushTokens.tokenCreatedAt,
        lastPushAt: pushTokens.lastPushAt,
      })
      .from(pushTokens)
      .where(eq(pushTokens.site, site))
      .orderBy(pushTokens.monitorId);
    return rows.map((r) => ({
      monitorId: r.monitorId,
      hasUrl: Boolean(r.hasUrl),
      createdAt: r.hasUrl && r.tokenCreatedAt !== null ? toIso(r.tokenCreatedAt) : null,
      lastPushAt: r.lastPushAt === null ? null : toIso(r.lastPushAt),
    }));
  }

  /** Every row of the site as the silent rule reads it. */
  async watches(site: string): Promise<PushWatch[]> {
    return this.platform.db
      .select({
        monitorId: pushTokens.monitorId,
        lastPushAt: pushTokens.lastPushAt,
        watchSince: pushTokens.watchSince,
        configVersion: pushTokens.configVersion,
      })
      .from(pushTokens)
      .where(eq(pushTokens.site, site));
  }

  /** Starts the silence clock of an enabled push monitor at `nowMs` (a row without a token if it has none). */
  async arm(site: string, monitorId: string, configVersion: number, nowMs: number): Promise<void> {
    await this.platform.db
      .insert(pushTokens)
      .values({ site, monitorId, watchSince: nowMs, configVersion, createdAt: nowMs })
      .onConflictDoUpdate({
        target: [pushTokens.site, pushTokens.monitorId],
        set: { watchSince: nowMs },
        setWhere: sql`${pushTokens.watchSince} is null`,
      });
  }

  /** Stops the silence clock of a paused push monitor; enabling it again restarts it. */
  async disarm(site: string, monitorId: string): Promise<void> {
    await this.platform.db
      .update(pushTokens)
      .set({ watchSince: null })
      .where(and(eq(pushTokens.site, site), eq(pushTokens.monitorId, monitorId)));
  }

  /** Deletes the rows (and so the tokens) of monitors the config no longer has as push monitors. */
  async forget(site: string, monitorIds: readonly string[]): Promise<void> {
    if (monitorIds.length === 0) return;
    await this.platform.db
      .delete(pushTokens)
      .where(and(eq(pushTokens.site, site), inArray(pushTokens.monitorId, [...monitorIds])));
  }
}
