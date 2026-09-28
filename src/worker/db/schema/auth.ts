import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ApiKeyScope, Role } from "@/shared/auth";
import { createdAt, json, ms } from "./_helpers";

/**
 * Accounts (src/worker/auth). `users`, `sessions`, `accounts`, `verifications` and `jwks` are Better Auth's
 * tables, handed to its Drizzle adapter under its model names (src/worker/auth/instance.ts); their timestamps are
 * `Date`s stored as epoch milliseconds, the way Better Auth reads and writes them. `invites` and `api_keys`
 * are Uptellis' own and store plain epoch milliseconds like every other table.
 */
const date = () => integer({ mode: "timestamp_ms" });

export const users = sqliteTable("users", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer({ mode: "boolean" }).notNull().default(false),
  image: text(),
  /** `owner`, `admin` or `viewer` (src/shared/auth.ts); the first account is the owner. */
  role: text().$type<Role>().notNull().default("viewer"),
  createdAt: date().notNull(),
  updatedAt: date().notNull(),
});

export const sessions = sqliteTable(
  "sessions",
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: date().notNull(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: date().notNull(),
    updatedAt: date().notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** Sign-in methods of a user: `credential` (email and password, hashed) or an OAuth provider. */
export const accounts = sqliteTable(
  "accounts",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: date(),
    refreshTokenExpiresAt: date(),
    scope: text(),
    password: text(),
    createdAt: date().notNull(),
    updatedAt: date().notNull(),
  },
  (t) => [index("accounts_user_id_idx").on(t.userId)],
);

/** Short-lived values Better Auth checks once (OAuth state). */
export const verifications = sqliteTable(
  "verifications",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: date().notNull(),
    createdAt: date().notNull(),
    updatedAt: date().notNull(),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** JWT signing keys (the JWT plugin); private keys are encrypted with `BETTER_AUTH_SECRET`. */
export const jwks = sqliteTable("jwks", {
  id: text().primaryKey(),
  publicKey: text().notNull(),
  privateKey: text().notNull(),
  alg: text(),
  crv: text(),
  createdAt: date().notNull(),
  expiresAt: date(),
});

/** One-time invite links: only the SHA-256 of the token is stored. */
export const invites = sqliteTable("invites", {
  id: text().primaryKey(),
  tokenHash: text().notNull().unique(),
  role: text().$type<Role>().notNull(),
  /** When set, only this address may accept. */
  email: text(),
  createdBy: text(),
  expiresAt: ms().notNull(),
  acceptedAt: ms(),
  acceptedBy: text(),
  createdAt: createdAt(),
});

/** API keys for pushers and agents: one site, some scopes; only the SHA-256 of the secret is stored. */
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text().primaryKey(),
    site: text().notNull(),
    name: text().notNull(),
    scopes: json<ApiKeyScope[]>().notNull(),
    secretHash: text().notNull(),
    createdBy: text(),
    lastUsedAt: ms(),
    revokedAt: ms(),
    createdAt: createdAt(),
  },
  (t) => [index("api_keys_site_idx").on(t.site)],
);
