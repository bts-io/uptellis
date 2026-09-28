/**
 * One-time invite links. An invite carries a role (and optionally the one address that may use it) and
 * expires 7 days after it was created. The link `<base URL>/invite/<token>` is returned once; only the
 * SHA-256 of the token is stored. Accepting claims the invite in one guarded UPDATE, so a link creates at
 * most one account however often it is replayed.
 */
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { Role } from "@/shared/auth";
import { AUTH_PAGES, INVITE_TTL_S, type InviteSummary, type IssuedInvite } from "@/shared/schemas/auth";
import { invites } from "../db/schema";
import { toIso } from "../db/util";
import type { AuthPlatform } from "./instance";
import { hashToken, randomId, randomToken } from "./tokens";

type Row = typeof invites.$inferSelect;

const summary = (r: Row, now: number): InviteSummary => ({
  id: r.id,
  role: r.role,
  email: r.email,
  status: r.acceptedAt !== null ? "accepted" : r.expiresAt <= now ? "expired" : "pending",
  createdAt: toIso(r.createdAt),
  expiresAt: toIso(r.expiresAt),
  createdBy: r.createdBy,
});

export async function createInvite(
  p: AuthPlatform,
  input: { role: Role; email: string | null; createdBy: string },
  baseUrl: string,
): Promise<IssuedInvite> {
  const token = randomToken();
  const now = p.now();
  const [row] = await p.db
    .insert(invites)
    .values({
      id: randomId(),
      tokenHash: await hashToken(token),
      role: input.role,
      email: input.email,
      createdBy: input.createdBy,
      expiresAt: now + INVITE_TTL_S * 1000,
      createdAt: now,
    })
    .returning();
  return { ...summary(row!, now), url: `${baseUrl}${AUTH_PAGES.invite}/${token}` };
}

export async function listInvites(p: AuthPlatform): Promise<InviteSummary[]> {
  const now = p.now();
  const rows = await p.db.select().from(invites).orderBy(desc(invites.createdAt));
  return rows.map((r) => summary(r, now));
}

/** Deletes an invite (used or not); false when there is none. */
export async function deleteInvite(p: AuthPlatform, id: string): Promise<boolean> {
  const rows = await p.db.delete(invites).where(eq(invites.id, id)).returning({ id: invites.id });
  return rows.length > 0;
}

const usable = (tokenHash: string, now: number) =>
  and(eq(invites.tokenHash, tokenHash), isNull(invites.acceptedAt), gt(invites.expiresAt, now));

/** The invite behind `token` while it is unused and unexpired, else null. */
export async function pendingInvite(p: AuthPlatform, token: string): Promise<Row | null> {
  const [row] = await p.db
    .select()
    .from(invites)
    .where(usable(await hashToken(token), p.now()));
  return row ?? null;
}

/** Marks the invite used; null when it was used, expired or deleted in the meantime. */
export async function claimInvite(p: AuthPlatform, token: string): Promise<Row | null> {
  const now = p.now();
  const [row] = await p.db
    .update(invites)
    .set({ acceptedAt: now })
    .where(usable(await hashToken(token), now))
    .returning();
  return row ?? null;
}

/** Hands a claimed invite back (the account could not be created). */
export async function releaseInvite(p: AuthPlatform, id: string): Promise<void> {
  await p.db.update(invites).set({ acceptedAt: null }).where(eq(invites.id, id));
}

export async function recordAcceptance(p: AuthPlatform, id: string, userId: string): Promise<void> {
  await p.db.update(invites).set({ acceptedBy: userId }).where(eq(invites.id, id));
}
