/**
 * The admin API (`/api/admin/*`, contract in src/shared/schemas/admin.ts) through `api()`: in the browser a
 * same-origin fetch that carries the admin cookie, during SSR the in-process bridge (the page request has
 * already passed the admin gate). Every response is parsed with its contract schema.
 */

import { notFound } from "@tanstack/react-router";
import {
  ConfigErrorResponse,
  type ConfigIssue,
  ConfigState,
  type CreateSourceRequest,
  DeliveryList,
  ImportResult,
  IssuedKey,
  IssuedPushUrl,
  NotifyTestResult,
  PushTokenList,
  RevisionList,
  SaveConfigResponse,
  SourceKeyList,
} from "@/shared/schemas/admin";
import { ApiError, api } from "../api";

const base = (site: string) => `/api/admin/sites/${encodeURIComponent(site)}`;

export const getConfig = async (site: string) => ConfigState.parse(await api(`${base(site)}/config`));

export const saveConfig = async (site: string, config: unknown, baseVersion: number, note?: string) =>
  SaveConfigResponse.parse(
    await api(`${base(site)}/config`, {
      method: "PUT",
      json: { config, baseVersion, note: note || undefined },
    }),
  );

/** Creates a site with `config` as its version 1 (409 when the slug exists). */
export const createSite = async (config: unknown) =>
  SaveConfigResponse.parse(await api("/api/admin/sites", { method: "POST", json: { config } }));

/** The `sites/<slug>.json` download (a plain link: the browser saves the attachment). */
export const exportHref = (site: string) => `${base(site)}/config/export`;

/** Checks (`dryRun`) or saves a config file's text; the diff is against the saved config. */
export const importConfig = async (site: string, text: string, dryRun: boolean) =>
  ImportResult.parse(
    await api(`${base(site)}/config/import${dryRun ? "?dryRun=1" : ""}`, {
      method: "POST",
      body: text,
      headers: { "content-type": "application/json" },
    }),
  );

export const getRevisions = async (site: string) =>
  RevisionList.parse(await api(`${base(site)}/config/revisions`));

export const restoreRevision = async (site: string, version: number) =>
  SaveConfigResponse.parse(
    await api(`${base(site)}/config/revisions/${version}/restore`, { method: "POST" }),
  );

export const getSources = async (site: string) => SourceKeyList.parse(await api(`${base(site)}/sources`));

export const createSource = async (site: string, req: CreateSourceRequest) =>
  IssuedKey.parse(await api(`${base(site)}/sources`, { method: "POST", json: req }));

export const rotateKey = async (site: string, keyId: string) =>
  IssuedKey.parse(await api(`${base(site)}/sources/${encodeURIComponent(keyId)}/rotate`, { method: "POST" }));

/** The push URL state of each push monitor of the saved config (never a token). */
export const getPushTokens = async (site: string) =>
  PushTokenList.parse(await api(`${base(site)}/push-tokens`));

/** Creates or rotates a push monitor's URL; the response is the only place the URL appears. */
export const issuePushUrl = async (site: string, monitorId: string) =>
  IssuedPushUrl.parse(
    await api(`${base(site)}/monitors/${encodeURIComponent(monitorId)}/push-token`, { method: "POST" }),
  );

/** The site's recent notification deliveries, newest first. */
export const getDeliveries = async (site: string, limit = 50) =>
  DeliveryList.parse(await api(`${base(site)}/notifications?limit=${limit}`));

export type TestKind = "down" | "up" | "stale" | "recovered";

/** What a channel test came to: sent, or failed with a short code (and the server's message when it had one). */
export type ChannelTestOutcome =
  | { sent: true; status: number }
  | { sent: false; status: number | null; error: string; message?: string };

/**
 * Sends one TEST message to one saved channel (`POST /api/admin/notify/test?site=&channel=&kind=`), about
 * `service` when given (`&service=`, a down or up card for that service).
 */
export async function testChannel(
  site: string,
  channel: string,
  kind: TestKind,
  service?: string,
): Promise<ChannelTestOutcome> {
  const q = new URLSearchParams({ site, channel, kind, ...(service ? { service } : {}) });
  try {
    const r = NotifyTestResult.parse(await api(`/api/admin/notify/test?${q}`, { method: "POST" }));
    return r.sent
      ? { sent: true, status: r.status }
      : { sent: false, status: r.status, error: r.error ?? "not_sent" };
  } catch (err) {
    if (err instanceof ApiError) {
      // 502: the channel did not take the message; the body is the same result with its error code.
      const r = NotifyTestResult.safeParse(err.body);
      if (r.success && !r.data.sent)
        return { sent: false, status: r.data.status, error: r.data.error ?? err.code };
      return { sent: false, status: err.status, error: err.code, message: err.message };
    }
    return {
      sent: false,
      status: null,
      error: "network",
      message: "The request failed. Check the connection.",
    };
  }
}

/** What went wrong with a save, restore or import, in the shape the editor shows. */
export interface AdminFailure {
  message: string;
  issues: ConfigIssue[];
  /** Set on a 409: the version someone else saved meanwhile. */
  conflictVersion: number | null;
}

export function describeFailure(err: unknown): AdminFailure {
  if (err instanceof ApiError) {
    const body = ConfigErrorResponse.safeParse(err.body);
    if (body.success)
      return {
        message: body.data.message,
        issues: body.data.issues,
        conflictVersion: body.data.error === "conflict" ? (body.data.currentVersion ?? null) : null,
      };
    return { message: err.message, issues: [], conflictVersion: null };
  }
  return {
    message: "The request failed. Check the connection and try again.",
    issues: [],
    conflictVersion: null,
  };
}

/** An admin API 404 (no admin cookie, unknown site) becomes the 404 page, as the admin gate answers for `/admin`. */
export function orNotFound(err: unknown): never {
  if (err instanceof ApiError && err.status === 404) throw notFound();
  throw err;
}
