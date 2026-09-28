/**
 * The delivery log read for admin (`GET /api/admin/sites/:site/notifications`): a site's recent rows of the
 * `notifications` table, newest first. Only short error codes leave here; anything else in `error` (it
 * should never hold more) is reduced to `error`.
 */
import { desc, eq, sql } from "drizzle-orm";
import type { Delivery, DeliveryStatus } from "@/shared/schemas/admin";
import { type Db, schema } from "@/worker/db";
import { toIso } from "@/worker/db/util";

const { notifications } = schema;

/** A provider error code: short, plain; never a URL, address or response body. */
const CODE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;
export const safeErrorCode = (error: string | null): string | null =>
  error === null ? null : CODE.test(error) ? error : "error";

const STATUSES: readonly DeliveryStatus[] = ["pending", "sent", "failed"];

export async function listDeliveries(db: Db, site: string, limit: number): Promise<Delivery[]> {
  const rows = await db
    .select({
      incidentId: notifications.incidentId,
      kind: notifications.kind,
      status: notifications.status,
      error: notifications.error,
      sentAt: notifications.sentAt,
      createdAt: notifications.createdAt,
      channel: notifications.channel,
      attempts: notifications.attempts,
      retryable: notifications.retryable,
      lastAttemptAt: notifications.lastAttemptAt,
    })
    .from(notifications)
    .where(eq(notifications.site, site))
    .orderBy(desc(notifications.createdAt), desc(sql`rowid`))
    .limit(limit);
  return rows.map((r) => ({
    incidentId: r.incidentId,
    kind: r.kind,
    channel: r.channel,
    status: STATUSES.includes(r.status) ? r.status : "failed",
    attempts: r.attempts,
    retryable: r.status === "failed" ? r.retryable : null,
    createdAt: toIso(r.createdAt),
    sentAt: r.sentAt === null ? null : toIso(r.sentAt),
    lastAttemptAt: r.lastAttemptAt === null ? null : toIso(r.lastAttemptAt),
    error: r.status === "failed" ? safeErrorCode(r.error) : null,
  }));
}
