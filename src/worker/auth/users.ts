/**
 * Users and their roles. Only an owner may grant the owner role or change or remove an owner, and the last
 * owner can never be demoted or removed: both checks run inside the one UPDATE or DELETE statement, so two
 * admins acting at once cannot leave the instance without an owner.
 */
import { and, asc, eq, max, ne, or, sql } from "drizzle-orm";
import type { Role } from "@/shared/auth";
import type { UserListEntry, UserSummary } from "@/shared/schemas/auth";
import { accounts, sessions, users } from "../db/schema";
import type { AuthPlatform } from "./instance";

type Row = typeof users.$inferSelect;

export const userSummary = (r: Row): UserSummary => ({
  id: r.id,
  name: r.name,
  email: r.email,
  image: r.image,
  role: r.role,
  createdAt: r.createdAt.toISOString(),
});

/** Every user, oldest first, with the start of their newest session as the last sign-in. */
export async function listUsers(p: AuthPlatform): Promise<UserListEntry[]> {
  const rows = await p.db
    .select({ user: users, lastSignIn: max(sessions.createdAt) })
    .from(users)
    .leftJoin(sessions, eq(sessions.userId, users.id))
    .groupBy(users.id)
    .orderBy(asc(users.createdAt));
  return rows.map((r) => ({ ...userSummary(r.user), lastSignInAt: r.lastSignIn?.toISOString() ?? null }));
}

export async function getUser(p: AuthPlatform, id: string): Promise<Row | null> {
  const [row] = await p.db.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

export async function userByEmail(p: AuthPlatform, email: string): Promise<Row | null> {
  const [row] = await p.db
    .select()
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()));
  return row ?? null;
}

/** Sets a role without the owner checks (the invite that created the user decides it). */
export async function setRole(p: AuthPlatform, id: string, role: Role): Promise<void> {
  await p.db
    .update(users)
    .set({ role, updatedAt: new Date(p.now()) })
    .where(eq(users.id, id));
}

export type UserChange<T> =
  | { ok: true; value: T }
  | { ok: false; error: "not_found" | "forbidden" | "last_owner" };

/** Rows that stay allowed to change: not an owner, or not the last one. */
const notLastOwner = () =>
  or(ne(users.role, "owner"), sql`(select count(*) from ${users} where ${users.role} = 'owner') > 1`);

/** Why a guarded statement touched no row. */
async function refusal(p: AuthPlatform, id: string): Promise<UserChange<never>> {
  return { ok: false, error: (await getUser(p, id)) ? "last_owner" : "not_found" };
}

export async function changeRole(
  p: AuthPlatform,
  actor: Role,
  id: string,
  role: Role,
): Promise<UserChange<UserSummary>> {
  const target = await getUser(p, id);
  if (!target) return { ok: false, error: "not_found" };
  if ((target.role === "owner" || role === "owner") && actor !== "owner")
    return { ok: false, error: "forbidden" };
  const guard = role === "owner" ? eq(users.id, id) : and(eq(users.id, id), notLastOwner());
  const [row] = await p.db
    .update(users)
    .set({ role, updatedAt: new Date(p.now()) })
    .where(guard)
    .returning();
  return row ? { ok: true, value: userSummary(row) } : refusal(p, id);
}

/** Removes a user with its sessions and sign-in methods. */
export async function removeUser(p: AuthPlatform, actor: Role, id: string): Promise<UserChange<null>> {
  const target = await getUser(p, id);
  if (!target) return { ok: false, error: "not_found" };
  if (target.role === "owner" && actor !== "owner") return { ok: false, error: "forbidden" };
  const [row] = await p.db
    .delete(users)
    .where(and(eq(users.id, id), notLastOwner()))
    .returning({ id: users.id });
  if (!row) return refusal(p, id);
  // The foreign keys cascade on D1; SQLite without `foreign_keys` on would keep these rows.
  await p.batch([
    p.db.delete(sessions).where(eq(sessions.userId, id)),
    p.db.delete(accounts).where(eq(accounts.userId, id)),
  ]);
  return { ok: true, value: null };
}
