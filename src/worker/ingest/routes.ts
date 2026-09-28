/**
 * `POST /api/ingest/{kuma,facts,events}` as a Hono sub-app (plan section 5). Order of checks:
 *
 * 1. body over 256 KB -> 413 (Content-Length first, then a capped read; nothing is hashed before this)
 * 2. `X-Uptellis-*` headers, timestamp window, key id (D1 keys, then env keys: ./keys.ts), HMAC -> 401
 * 3. key id bound to a source this route does not accept -> 403
 * 4. nonce already seen -> 409
 * 5. a request signed with a key's `next` secret promotes it to current (best effort)
 *
 * A request with `Authorization: Bearer <API key>` replaces steps 2 to 5: an unknown or revoked key -> 401,
 * a key without the `ingest` scope -> 403, and `X-Uptellis-Source` must name a source of the key's site
 * that this route accepts -> 403. There is no nonce: the key is the credential, TLS protects it.
 *
 * 6. JSON -> 400, Zod and display safety -> 422 (field paths only)
 * 7. adapt, store, cache -> 202 (latest) or 200 (older than the last accepted, history only); the key's
 *    `lastUsedAt` is touched (best effort, at most once a minute)
 *
 * Responses carry ids and counts only; logs carry reason codes, ids and counts, never payloads.
 */
import { type Context, Hono } from "hono";
import type { Platform } from "@/platform/types";
import { SourceId } from "@/shared/model";
import { INGEST_SOURCE_HEADER } from "@/shared/schemas/auth";
import { MAX_BODY_BYTES, verifyRequest } from "@/shared/signing";
import type { AppEnv } from "@/worker/app-env";
import { readCapped, TooLarge } from "@/worker/read-capped";
import { isoSeconds } from "../adapters/common";
import { bearerToken, touchApiKey } from "../auth/api-keys";
import { accountsOf, principalOf } from "../auth/context";
import { type IngestBackend, ingestPayload } from "../engine/ingest-service";
import { getSiteConfig, seedConfigs } from "../engine/sites";
import { PayloadRejected } from "./issues";
import {
  type EnvIngestKeys,
  INGEST_KEY_BINDINGS,
  type IngestRoute,
  type KeyBinding,
  type KeyBindings,
  type ResolvedKey,
  resolveKey,
  routeAllows,
} from "./keys";

/** Nonces are kept this long (well past the 120 s window). */
export const NONCE_TTL_S = 3600;

export interface IngestRouteOptions {
  /** Env key id -> site and source; defaults to `INGEST_KEY_BINDINGS`. */
  bindings?: KeyBindings;
  /** Clock for tests. */
  now?: () => Date;
}

const log = (fields: Record<string, string | number | boolean>) =>
  console.log(JSON.stringify({ evt: "ingest", ...fields }));

/** A failed best-effort key step, by error name only. */
const keyWarn = (step: string, keyId: string, err: unknown) =>
  console.warn(
    JSON.stringify({ evt: "ingest", step, keyId, name: err instanceof Error ? err.name : "unknown" }),
  );

const reject = (status: 400 | 401 | 403 | 409 | 413 | 422, error: string, extra: object = {}) =>
  Response.json({ error, ...extra }, { status, headers: { "cache-control": "no-store" } });

/** Builds the store, cache and keys for a request's platform and env ingest keys. */
export type IngestBackendResolver = (platform: Platform, envKeys: EnvIngestKeys) => IngestBackend;

/** Who is posting: the source it reports as, the key id for logs, and how to record the key's use. */
type Caller =
  | { ok: true; binding: KeyBinding; keyId: string; rotated: boolean; touch: () => Promise<void> }
  | { ok: false; res: Response };

/**
 * An HMAC-signed request: signature (401), the key's source accepted by this route (403), nonce (409), and
 * promotion of a key's `next` secret.
 */
async function bySignature(
  c: Context<AppEnv>,
  route: IngestRoute,
  deps: IngestBackend,
  body: Uint8Array<ArrayBuffer>,
  now: Date,
  bindings: KeyBindings,
): Promise<Caller> {
  const { store, keys } = deps;
  let resolved: ResolvedKey | null = null;
  const verified = await verifyRequest({
    headers: c.req.raw.headers,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    body,
    now,
    keysFor: async (keyId) => {
      resolved = await resolveKey(keyId, c.var.envIngestKeys, bindings, keys);
      return resolved?.candidates.map((k) => k.secret) ?? null;
    },
  });
  if (!verified.ok) {
    log({ route, status: 401, reason: verified.reason });
    return { ok: false, res: reject(401, "unauthorized", { reason: verified.reason }) };
  }
  // Set by keysFor, which a verified request always went through.
  const { binding, candidates } = (resolved as ResolvedKey | null)!;
  const used = candidates[verified.keyIndex]!;
  if (!routeAllows(route, binding.source)) {
    log({ route, status: 403, reason: "wrong_source", keyId: verified.keyId });
    return { ok: false, res: reject(403, "forbidden", { reason: "wrong_source" }) };
  }

  const expiresAt = isoSeconds(now.getTime() + NONCE_TTL_S * 1000);
  if (!(await store.claimNonce(verified.nonce, expiresAt))) {
    log({ route, status: 409, reason: "replay", keyId: verified.keyId });
    return { ok: false, res: reject(409, "replay") };
  }
  if (keys && used.sealedNext) {
    await keys.promote(verified.keyId, used.sealedNext).then(
      () => log({ route, step: "key_promoted", keyId: verified.keyId }),
      (err: unknown) => keyWarn("promote", verified.keyId, err),
    );
  }
  return {
    ok: true,
    binding,
    keyId: verified.keyId,
    rotated: verified.keyIndex > 0,
    touch: async () => {
      await keys?.touch(verified.keyId, binding, now.getTime());
    },
  };
}

/**
 * A request with `Authorization: Bearer <API key>`: a valid, unrevoked key (401) with the `ingest` scope
 * (403), reporting as the source named in `X-Uptellis-Source`, which must be one of the key's site's
 * configured sources that this route accepts (403). The principal was resolved by the accounts middleware.
 */
async function byApiKey(c: Context<AppEnv>, route: IngestRoute, deps: IngestBackend): Promise<Caller> {
  const principal = principalOf(c);
  if (principal.kind !== "apiKey") {
    log({ route, status: 401, reason: "bad_api_key" });
    return { ok: false, res: reject(401, "unauthorized", { reason: "bad_api_key" }) };
  }
  const keyId = `api:${principal.keyId}`;
  if (!principal.scopes.includes("ingest")) {
    log({ route, status: 403, reason: "scope", keyId });
    return { ok: false, res: reject(403, "forbidden", { reason: "scope" }) };
  }
  const source = SourceId.safeParse(c.req.header(INGEST_SOURCE_HEADER) ?? "");
  const config = await getSiteConfig(deps.configs ?? seedConfigs, principal.site);
  if (
    !source.success ||
    !config?.sources.some((s) => s.id === source.data) ||
    !routeAllows(route, source.data)
  ) {
    log({ route, status: 403, reason: "wrong_source", keyId });
    return { ok: false, res: reject(403, "forbidden", { reason: "wrong_source" }) };
  }
  const accounts = accountsOf(c);
  return {
    ok: true,
    binding: { site: principal.site, source: source.data },
    keyId,
    rotated: false,
    touch: async () => {
      if (accounts) await touchApiKey(accounts.platform, principal.keyId);
    },
  };
}

/**
 * The ingest sub-app. `backend` builds the store and cache for the request (the SQL + KV implementation in
 * the app, the in-memory one in tests).
 */
export function ingestRoutes(backend: IngestBackendResolver, options: IngestRouteOptions = {}) {
  const bindings = options.bindings ?? INGEST_KEY_BINDINGS;
  const clock = options.now ?? (() => new Date());
  const app = new Hono<AppEnv>();

  const handle = (route: IngestRoute) =>
    app.post(`/${route}`, async (c) => {
      const now = clock();
      let body: Uint8Array<ArrayBuffer>;
      try {
        body = await readCapped(c.req.raw, MAX_BODY_BYTES);
      } catch (e) {
        if (!(e instanceof TooLarge)) throw e;
        log({ route, status: 413, reason: "too_large" });
        return reject(413, "payload_too_large", { maxBytes: MAX_BODY_BYTES });
      }

      const deps = backend(c.var.platform, c.var.envIngestKeys);
      const caller =
        bearerToken(c.req.raw) !== null
          ? await byApiKey(c, route, deps)
          : await bySignature(c, route, deps, body, now, bindings);
      if (!caller.ok) return caller.res;
      const { binding, keyId } = caller;

      let json: unknown;
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body);
        json = JSON.parse(text);
      } catch {
        log({ route, status: 400, reason: "invalid_json", keyId });
        return reject(400, "invalid_json");
      }

      try {
        const out = await ingestPayload(deps, route, binding, json, now, { rawBody: text });
        const status = out.latest ? 202 : 200;
        log({
          route,
          status,
          source: out.source,
          services: out.counts.services,
          heartbeats: out.counts.heartbeats,
          facts: out.counts.facts,
          opened: out.incidents.opened.length,
          resolved: out.incidents.resolved.length,
          ...(caller.rotated ? { rotatedKey: true } : {}),
        });
        await caller.touch().catch((err: unknown) => keyWarn("touch", keyId, err));
        return c.json({ ok: true, ...out }, status, { "cache-control": "no-store" });
      } catch (e) {
        if (e instanceof PayloadRejected) {
          log({ route, status: 422, reason: "invalid_payload", issues: e.issues.length });
          return reject(422, "invalid_payload", { issues: e.issues });
        }
        // Store or cache failure: the error may quote SQL or values, so only its name is logged.
        log({ route, status: 500, reason: "internal", name: e instanceof Error ? e.name : "unknown" });
        return c.json({ error: "internal", message: "Something went wrong" }, 500);
      }
    });

  handle("kuma");
  handle("facts");
  handle("events");
  return app;
}
