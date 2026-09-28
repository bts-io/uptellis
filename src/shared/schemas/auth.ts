/**
 * Accounts API contract (Phase 5): request and response bodies of the setup, session, invite, user and API
 * key routes. Roles and permissions come from src/shared/auth.ts; Better Auth itself owns `/api/auth/*`.
 *
 * Better Auth routes (JSON, cookies set by the server):
 * - `POST   /api/auth/sign-in/email`        { email, password } -> session cookie
 * - `POST   /api/auth/sign-in/social`       { provider: "github" | "google", callbackURL } -> { url } to follow
 * - `POST   /api/auth/sign-out`             -> clears the session cookie
 * - `GET    /api/auth/get-session`          -> the Better Auth session, or null
 * - `GET    /api/auth/token`                -> { token }: a short-lived JWT for the signed-in user
 * - `GET    /api/auth/jwks`                 -> the public keys that verify those JWTs
 * Sign-up (`/api/auth/sign-up/email`) is closed: accounts come only from first-run setup and invites.
 *
 * Uptellis routes:
 * - `GET    /api/me`                                 -> Me (anyone; `user` is null when signed out)
 * - `GET    /api/setup`                              -> SetupStatus
 * - `POST   /api/setup`                              SetupRequest -> 201 Me (the owner, signed in); 409 once any user exists
 * - `GET    /api/invites/:token`                     -> InviteInfo (404 when unknown, used or expired)
 * - `POST   /api/invites/:token/accept`              AcceptInviteRequest -> 201 Me (signed in)
 * - `GET    /api/admin/users`                        -> UserList                     (users.manage)
 * - `PATCH  /api/admin/users/:id`                    ChangeRoleRequest -> UserSummary (users.manage; 409 for the last owner)
 * - `DELETE /api/admin/users/:id`                    -> 204                          (users.manage; 409 for the last owner)
 * - `GET    /api/admin/invites`                      -> InviteList                   (users.manage)
 * - `POST   /api/admin/invites`                      CreateInviteRequest -> 201 IssuedInvite (users.manage)
 * - `DELETE /api/admin/invites/:id`                  -> 204                          (users.manage)
 * - `GET    /api/admin/sites/:site/api-keys`         -> ApiKeyList                   (sources.manage)
 * - `POST   /api/admin/sites/:site/api-keys`         CreateApiKeyRequest -> 201 IssuedApiKey (sources.manage)
 * - `DELETE /api/admin/sites/:site/api-keys/:id`     -> ApiKeySummary, now revoked   (sources.manage)
 *
 * Only an owner may grant the owner role, or change or remove an owner. Errors are `AuthErrorResponse`:
 * 400 `invalid` with `issues`, 401 `unauthorized` (signed out), 403 `forbidden` (signed in without the
 * permission, or a cross-site write), 404 `not_found`, 409 `conflict`.
 */
import { z } from "zod";
import { API_KEY_SCOPES, PERMISSIONS, Role } from "../auth";
import { SiteSlug } from "../model";

/** Pages the UI serves for accounts; the gate always lets them through. `invite` takes `/<token>`. */
export const AUTH_PAGES = { setup: "/setup", signIn: "/sign-in", invite: "/invite" } as const;

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export const Email = z.email().max(254);
export const Password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);
export const DisplayName = z.string().trim().min(1).max(100);

/** An ISO 8601 UTC timestamp. */
const Iso = z.string();

/** Sign-in methods this instance offers: GitHub and Google only when their client id and secret are set. */
export const AuthProviders = z.object({
  emailPassword: z.literal(true),
  github: z.boolean(),
  google: z.boolean(),
});
export type AuthProviders = z.infer<typeof AuthProviders>;

export const UserSummary = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  role: Role,
  createdAt: Iso,
});
export type UserSummary = z.infer<typeof UserSummary>;

export const Me = z.object({
  /** Null when signed out. */
  user: UserSummary.nullable(),
  /** What the signed-in user may do (empty when signed out); `page.view` on public sites is always open. */
  permissions: z.array(z.enum(PERMISSIONS)),
  providers: AuthProviders,
  /** True until the first account (the owner) exists: the UI sends everyone to `/setup`. */
  setupNeeded: z.boolean(),
});
export type Me = z.infer<typeof Me>;

export const SetupStatus = z.object({ needed: z.boolean() });
export type SetupStatus = z.infer<typeof SetupStatus>;

export const SetupRequest = z.object({ name: DisplayName, email: Email, password: Password });
export type SetupRequest = z.infer<typeof SetupRequest>;

/** A user in the admin list: when they last signed in (their newest session on record; null for none). */
export const UserListEntry = UserSummary.extend({ lastSignInAt: Iso.nullable() });
export type UserListEntry = z.infer<typeof UserListEntry>;

export const UserList = z.object({ users: z.array(UserListEntry) });
export type UserList = z.infer<typeof UserList>;

export const ChangeRoleRequest = z.object({ role: Role });
export type ChangeRoleRequest = z.infer<typeof ChangeRoleRequest>;

/** Invites expire this long after they are created. */
export const INVITE_TTL_S = 7 * 24 * 60 * 60;

export const CreateInviteRequest = z.object({
  role: Role,
  /** When set, only this address may accept the invite. */
  email: Email.optional(),
});
export type CreateInviteRequest = z.infer<typeof CreateInviteRequest>;

export const InviteStatus = z.enum(["pending", "accepted", "expired"]);
export type InviteStatus = z.infer<typeof InviteStatus>;

export const InviteSummary = z.object({
  id: z.string(),
  role: Role,
  email: z.string().nullable(),
  status: InviteStatus,
  createdAt: Iso,
  expiresAt: Iso,
  /** The user id that created it (null once that user is removed). */
  createdBy: z.string().nullable(),
});
export type InviteSummary = z.infer<typeof InviteSummary>;

/** A new invite: `url` (`<PUBLIC_URL>/invite/<token>`) is shown once and never stored in the clear. */
export const IssuedInvite = InviteSummary.extend({ url: z.string() });
export type IssuedInvite = z.infer<typeof IssuedInvite>;

export const InviteList = z.object({ invites: z.array(InviteSummary) });
export type InviteList = z.infer<typeof InviteList>;

/** What the invite page shows before the account is created. */
export const InviteInfo = z.object({ role: Role, email: z.string().nullable(), expiresAt: Iso });
export type InviteInfo = z.infer<typeof InviteInfo>;

export const AcceptInviteRequest = z.object({ name: DisplayName, email: Email, password: Password });
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequest>;

export const ApiKeyScope = z.enum(API_KEY_SCOPES);

export const ApiKeySummary = z.object({
  id: z.string(),
  site: SiteSlug,
  name: z.string(),
  scopes: z.array(ApiKeyScope),
  /** The key's public start (`upt_<id>`), enough to recognise it in a list. */
  prefix: z.string(),
  createdAt: Iso,
  createdBy: z.string().nullable(),
  lastUsedAt: Iso.nullable(),
  revokedAt: Iso.nullable(),
});
export type ApiKeySummary = z.infer<typeof ApiKeySummary>;

export const CreateApiKeyRequest = z.object({
  name: DisplayName.max(64),
  scopes: z
    .array(ApiKeyScope)
    .min(1)
    .refine((s) => new Set(s).size === s.length, "Scopes must be unique"),
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequest>;

/** A new API key: `key` is the secret, shown once. Send it as `Authorization: Bearer <key>`. */
export const IssuedApiKey = ApiKeySummary.extend({ key: z.string() });
export type IssuedApiKey = z.infer<typeof IssuedApiKey>;

/** Ingest with an API key names the source it reports as in this header (a source of the key's site). */
export const INGEST_SOURCE_HEADER = "X-Uptellis-Source";

export const ApiKeyList = z.object({ keys: z.array(ApiKeySummary) });
export type ApiKeyList = z.infer<typeof ApiKeyList>;

export const AuthErrorResponse = z.object({
  error: z.enum(["invalid", "unauthorized", "forbidden", "not_found", "conflict", "unavailable"]),
  message: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).default([]),
});
export type AuthErrorResponse = z.infer<typeof AuthErrorResponse>;
