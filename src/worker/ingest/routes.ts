/**
 * `POST /api/ingest/{kuma,facts,events}` as a Hono sub-app (plan section 5). Order of checks:
 *
 * 1. body over 256 KB -> 413 (Content-Length first, then a capped read; nothing is hashed before this)
 * 2. `X-Uptellis-*` headers, timestamp window, key id (D1 keys, then env keys: ./keys.ts), HMAC -> 401
 * 3. key id bound to a source this route does not accept -> 403
 * 4. nonce already seen -> 409
 * 5. a request signed with a key's `next` secret promotes it to current (best effort)
 * 6. JSON -> 400, Zod and display safety -> 422 (field paths only)
 * 7. adapt, store, cache -> 202 (latest) or 200 (older than the last accepted, history only); the key's
 *    `lastUsedAt` is touched (best effort, at most once a minute)
 *
 * Responses carry ids and counts only; logs carry reason codes, ids and counts, never payloads.
 */
import { Hono } from "hono";
import type { Platform } from "@/platform/types";
import { MAX_BODY_BYTES, verifyRequest } from "@/shared/signing";
import type { AppEnv } from "@/worker/app-env";
import { readCapped, TooLarge } from "@/worker/read-capped";
import { isoSeconds } from "../adapters/common";
import { type IngestBackend, ingestPayload } from "../engine/ingest-service";
import { PayloadRejected } from "./issues";
import {
  type EnvIngestKeys,
  INGEST_KEY_BINDINGS,
  type IngestRoute,
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

      const path = new URL(c.req.url).pathname;
      const envKeys = c.var.envIngestKeys;
      const deps = backend(c.var.platform, envKeys);
      const { store, keys } = deps;
      let resolved: ResolvedKey | null = null;
      const verified = await verifyRequest({
        headers: c.req.raw.headers,
        method: c.req.method,
        path,
        body,
        now,
        keysFor: async (keyId) => {
          resolved = await resolveKey(keyId, envKeys, bindings, keys);
          return resolved?.candidates.map((k) => k.secret) ?? null;
        },
      });
      if (!verified.ok) {
        log({ route, status: 401, reason: verified.reason });
        return reject(401, "unauthorized", { reason: verified.reason });
      }
      // Set by keysFor, which a verified request always went through.
      const { binding, candidates } = (resolved as ResolvedKey | null)!;
      const used = candidates[verified.keyIndex]!;
      if (!routeAllows(route, binding.source)) {
        log({ route, status: 403, reason: "wrong_source", keyId: verified.keyId });
        return reject(403, "forbidden", { reason: "wrong_source" });
      }

      const expiresAt = isoSeconds(now.getTime() + NONCE_TTL_S * 1000);
      if (!(await store.claimNonce(verified.nonce, expiresAt))) {
        log({ route, status: 409, reason: "replay", keyId: verified.keyId });
        return reject(409, "replay");
      }
      if (keys && used.sealedNext) {
        await keys.promote(verified.keyId, used.sealedNext).then(
          () => log({ route, step: "key_promoted", keyId: verified.keyId }),
          (err: unknown) => keyWarn("promote", verified.keyId, err),
        );
      }

      let json: unknown;
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body);
        json = JSON.parse(text);
      } catch {
        log({ route, status: 400, reason: "invalid_json", keyId: verified.keyId });
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
          ...(verified.keyIndex > 0 ? { rotatedKey: true } : {}),
        });
        await keys
          ?.touch(verified.keyId, binding, now.getTime())
          .catch((err: unknown) => keyWarn("touch", verified.keyId, err));
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
