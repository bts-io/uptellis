/**
 * The accounts API (contract in src/shared/schemas/auth.ts) through `api()`: same-origin fetches in the
 * browser (they carry the session cookie), the in-process bridge during SSR (it carries the page request's
 * principal). Uptellis routes are parsed with their schemas; Better Auth's own routes (`/api/auth/*`) are
 * called for their cookies and answer nothing the UI reads.
 */

import type { Role } from "@/shared/auth";
import {
  ApiKeyList,
  type CreateApiKeyRequest,
  type CreateInviteRequest,
  InviteInfo,
  InviteList,
  IssuedApiKey,
  IssuedInvite,
  Me,
  SetupStatus,
  UserList,
  UserSummary,
} from "@/shared/schemas/auth";
import { ApiError, api } from "../api";

export const getMe = async () => Me.parse(await api("/api/me"));
export const getSetupStatus = async () => SetupStatus.parse(await api("/api/setup"));

export const setupOwner = async (req: { name: string; email: string; password: string }) =>
  Me.parse(await api("/api/setup", { method: "POST", json: req }));

export const signInEmail = (email: string, password: string) =>
  api("/api/auth/sign-in/email", { method: "POST", json: { email, password } });

/** Starts GitHub or Google sign-in: Better Auth answers the provider's URL, the browser follows it. */
export async function signInSocial(provider: "github" | "google", next: string): Promise<void> {
  const { url } = await api<{ url?: string }>("/api/auth/sign-in/social", {
    method: "POST",
    json: { provider, callbackURL: next },
  });
  if (url) window.location.assign(url);
}

export const signOut = () => api("/api/auth/sign-out", { method: "POST", json: {} });

export const updateName = (name: string) => api("/api/auth/update-user", { method: "POST", json: { name } });

export const changePassword = (currentPassword: string, newPassword: string) =>
  api("/api/auth/change-password", {
    method: "POST",
    json: { currentPassword, newPassword, revokeOtherSessions: true },
  });

const invite = (token: string) => `/api/invites/${encodeURIComponent(token)}`;

export const getInvite = async (token: string) => InviteInfo.parse(await api(invite(token)));

export const acceptInvite = async (token: string, req: { name: string; email: string; password: string }) =>
  Me.parse(await api(`${invite(token)}/accept`, { method: "POST", json: req }));

export const getUsers = async () => UserList.parse(await api("/api/admin/users"));

export const changeRole = async (id: string, role: Role) =>
  UserSummary.parse(
    await api(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", json: { role } }),
  );

export const removeUser = (id: string) =>
  api(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });

export const getInvites = async () => InviteList.parse(await api("/api/admin/invites"));

export const createInvite = async (req: CreateInviteRequest) =>
  IssuedInvite.parse(await api("/api/admin/invites", { method: "POST", json: req }));

export const revokeInvite = (id: string) =>
  api(`/api/admin/invites/${encodeURIComponent(id)}`, { method: "DELETE" });

const keys = (site: string) => `/api/admin/sites/${encodeURIComponent(site)}/api-keys`;

export const getApiKeys = async (site: string) => ApiKeyList.parse(await api(keys(site)));

export const createApiKey = async (site: string, req: CreateApiKeyRequest) =>
  IssuedApiKey.parse(await api(keys(site), { method: "POST", json: req }));

export const revokeApiKey = (site: string, id: string) =>
  api(`${keys(site)}/${encodeURIComponent(id)}`, { method: "DELETE" });

/** A request's failure as a message and per-field issues (paths as the schemas name them). */
export interface AccountFailure {
  message: string;
  issues: { path: string; message: string }[];
}

export function accountFailure(err: unknown): AccountFailure {
  if (err instanceof ApiError) {
    const body = err.body as { issues?: unknown } | null;
    const issues = Array.isArray(body?.issues)
      ? (body.issues as AccountFailure["issues"]).filter((i) => typeof i?.path === "string")
      : [];
    return { message: err.message, issues };
  }
  return { message: "The request failed. Check the connection and try again.", issues: [] };
}

/**
 * A `next` target that stays on this origin: a path starting with one `/` (never `//host` or a scheme);
 * anything else becomes `fallback`.
 */
export function safeNext(next: unknown, fallback = "/"): string {
  return typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : fallback;
}
