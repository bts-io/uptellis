/**
 * Admin API, mounted at `/api/admin` (contracts: src/shared/schemas/admin.ts, and src/shared/schemas/auth.ts
 * for API keys). Every route needs a signed-in user with the route's permission (src/shared/auth.ts):
 * `config.edit` for config, revisions, import and the notification test, `sources.manage` for sources, ingest
 * keys and API keys, `instance.manage` for creating a site (`POST /sites`, the first-run setup uses it); 401 when signed out, 403 without the permission. Writes must be same-origin (403).
 *
 * Config routes read D1 directly (never a cache) so the editor always sees the stored version. Errors use
 * `ConfigErrorResponse`: 400 `invalid` with flattened `issues`, 404 `not_found`, 409 `conflict` with
 * `currentVersion`; creating or rotating a key without `SOURCE_MASTER_KEY` answers 503 `unavailable`.
 * Secrets appear only in the `IssuedKey` of a create or rotate. Every response is `Cache-Control: no-store`.
 *
 * `GET /sites/:site/notifications?limit=50` (`config.edit`, like the notification test) lists the site's
 * recent deliveries, newest first (`DeliveryList`; `limit` 1 to 200, default 50).
 *
 * `POST /notify/test?kind=stale|recovered|down|up[&site=][&source=][&service=][&channel=]` sends one alert
 * labelled TEST, built from the current state and recorded nowhere. With `channel` (any id of `channelsOf`,
 * the implicit `discord` included; 404 when unknown) it goes through that channel's provider; without it,
 * to `DISCORD_WEBHOOK_URL` as before channels (503 `unavailable` when unset). It answers
 * `{ site, channel, source, service?, kind, sent, status, error }` (`channel` null without one), 502 when
 * the channel did not take it.
 */
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { exportSiteConfig, type SiteConfig, SiteConfig as SiteConfigSchema } from "@/shared/config";
import { diffConfigs } from "@/shared/config/diff";
import { sourceKindOf } from "@/shared/model";
import {
  type ConfigErrorResponse,
  type ConfigIssue,
  CreateSiteRequest,
  CreateSourceRequest,
  DELIVERY_LIMIT,
  type DeliveryList,
  type ImportResult,
  type IssuedKey,
  KeyId,
  SaveConfigRequest,
  type SaveConfigResponse,
  type SourceKeyList,
} from "@/shared/schemas/admin";
import { type ApiKeyList, CreateApiKeyRequest } from "@/shared/schemas/auth";
import { readCapped, TooLarge } from "@/worker/read-capped";
import type { AppEnv } from "../app-env";
import { issueApiKey, listApiKeys, revokeApiKey } from "../auth/api-keys";
import { authError, principalOf, requirePermission } from "../auth/context";
import { D1ConfigStore, type SaveOutcome } from "../engine/config-store";
import { listDeliveries } from "../engine/delivery-log";
import { KeyStore } from "../engine/key-store";
import { MasterKeyMissing } from "../engine/seal";
import { isSameOrigin } from "../middleware/same-origin";
import { sendTestCard, TEST_CARD_KINDS } from "../notify";

type Ctx = Context<AppEnv>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Largest accepted config or import body. */
export const MAX_CONFIG_BYTES = 256 * 1024;

const fail = (
  c: Ctx,
  status: 400 | 404 | 409,
  error: ConfigErrorResponse["error"],
  message: string,
  extra: Partial<ConfigErrorResponse> = {},
) => c.json({ error, message, issues: [], ...extra } satisfies ConfigErrorResponse, status);

const notFound = (c: Ctx) => fail(c, 404, "not_found", "Unknown site");

/** Zod issues as `{ path, message }` with dotted paths (`sections.1.title`; empty for the root). */
const flatten = (error: z.ZodError): ConfigIssue[] =>
  error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));

type Checked = { ok: true; config: SiteConfig } | { ok: false; issues: ConfigIssue[] };

/** Validates a config for `slug`: the schema (defaults applied) and a slug that matches the URL. */
function check(slug: string, input: unknown): Checked {
  const r = SiteConfigSchema.safeParse(input);
  if (!r.success) return { ok: false, issues: flatten(r.error) };
  if (r.data.slug !== slug) return { ok: false, issues: [{ path: "slug", message: `Must be ${slug}` }] };
  return { ok: true, config: r.data };
}

/** The response for a save: the new version and diff, or the error it maps to. */
function saved(c: Ctx, out: SaveOutcome) {
  if (out.ok) return c.json({ version: out.version, diff: out.diff } satisfies SaveConfigResponse);
  if (out.error === "not_found") return notFound(c);
  return fail(c, 409, "conflict", "The config was saved by someone else; reload it", {
    currentVersion: out.currentVersion,
  });
}

/** 503 when the master key is missing (creating or rotating a key), else rethrows. */
function keyFailure(c: Ctx, err: unknown) {
  if (!(err instanceof MasterKeyMissing)) throw err;
  return c.json({ error: "unavailable", message: err.message, issues: [] }, 503);
}

/** Parses a JSON body, or says why it could not (too large, not JSON). */
async function readJson(c: Ctx): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  const text = await readText(c);
  if (text === null) return { ok: false, message: "Body is too large" };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, message: "Body is not JSON" };
  }
}

async function readText(c: Ctx): Promise<string | null> {
  try {
    return new TextDecoder().decode(await readCapped(c.req.raw, MAX_CONFIG_BYTES));
  } catch (err) {
    if (err instanceof TooLarge) return null;
    throw err;
  }
}

export function adminRoutes() {
  const app = new Hono<AppEnv>();
  const configs = (c: Ctx) => new D1ConfigStore(c.var.platform);
  const keys = (c: Ctx) => new KeyStore(c.var.platform, c.var.envIngestKeys);

  app.use("*", async (c, next) => {
    if (!SAFE_METHODS.has(c.req.method) && !isSameOrigin(c.req.raw)) {
      return authError(c, 403, "forbidden", "Cross-site request");
    }
    await next();
    c.res.headers.set("cache-control", "no-store");
  });
  app.use("/sites", requirePermission("instance.manage"));
  for (const path of [
    "/sites/:site/config",
    "/sites/:site/config/*",
    "/sites/:site/notifications",
    "/notify/*",
  ]) {
    app.use(path, requirePermission("config.edit"));
  }
  for (const path of [
    "/sites/:site/sources",
    "/sites/:site/sources/*",
    "/sites/:site/api-keys",
    "/sites/:site/api-keys/*",
  ]) {
    app.use(path, requirePermission("sources.manage"));
  }

  app.post("/sites", async (c) => {
    const read = await readJson(c);
    if (!read.ok) return fail(c, 400, "invalid", read.message);
    const req = CreateSiteRequest.safeParse(read.body);
    if (!req.success) return fail(c, 400, "invalid", "Config is invalid", { issues: flatten(req.error) });
    if (!(await configs(c).create(req.data.config))) {
      return fail(c, 409, "conflict", `The site ${req.data.config.slug} exists already`);
    }
    return c.json({ version: 1, diff: [] } satisfies SaveConfigResponse, 201);
  });

  app.get("/sites/:site/config", async (c) => {
    const state = await configs(c).load(c.req.param("site"));
    return state ? c.json(state) : notFound(c);
  });

  app.put("/sites/:site/config", async (c) => {
    const slug = c.req.param("site");
    const read = await readJson(c);
    if (!read.ok) return fail(c, 400, "invalid", read.message);
    const req = SaveConfigRequest.safeParse(read.body);
    if (!req.success) return fail(c, 400, "invalid", "Malformed request", { issues: flatten(req.error) });
    const store = configs(c);
    if (!(await store.load(slug))) return notFound(c);
    const checked = check(slug, req.data.config);
    if (!checked.ok) return fail(c, 400, "invalid", "Config is invalid", { issues: checked.issues });
    return saved(
      c,
      await store.save(slug, checked.config, {
        baseVersion: req.data.baseVersion,
        savedBy: "admin",
        note: req.data.note,
      }),
    );
  });

  app.get("/sites/:site/config/export", async (c) => {
    const state = await configs(c).load(c.req.param("site"));
    if (!state) return notFound(c);
    return c.body(exportSiteConfig(state.config), 200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${state.config.slug}.json"`,
    });
  });

  app.post("/sites/:site/config/import", async (c) => {
    const slug = c.req.param("site");
    const dryRun = c.req.query("dryRun") === "1";
    const store = configs(c);
    const current = await store.load(slug);
    if (!current) return notFound(c);
    const text = await readText(c);
    const invalid = (issues: ConfigIssue[]) =>
      c.json({ valid: false, issues, diff: [], version: null } satisfies ImportResult);
    if (text === null) return invalid([{ path: "", message: "File is too large" }]);
    let input: unknown;
    try {
      input = JSON.parse(text);
    } catch {
      return invalid([{ path: "", message: "Not a JSON file" }]);
    }
    const checked = check(slug, input);
    if (!checked.ok) return invalid(checked.issues);
    const diff = diffConfigs(current.config, checked.config);
    if (dryRun || diff.length === 0) {
      return c.json({ valid: true, issues: [], diff, version: null } satisfies ImportResult);
    }
    const out = await store.save(slug, checked.config, { baseVersion: current.version, savedBy: "import" });
    if (!out.ok) return saved(c, out);
    return c.json({ valid: true, issues: [], diff: out.diff, version: out.version } satisfies ImportResult);
  });

  app.get("/sites/:site/config/revisions", async (c) => {
    const list = await configs(c).revisions(c.req.param("site"));
    return list ? c.json(list) : notFound(c);
  });

  app.post("/sites/:site/config/revisions/:version/restore", async (c) => {
    const slug = c.req.param("site");
    const version = Number(c.req.param("version"));
    const store = configs(c);
    const current = await store.load(slug);
    if (!current) return notFound(c);
    const config = Number.isSafeInteger(version) ? await store.revision(slug, version) : null;
    if (!config) return fail(c, 404, "not_found", "Unknown revision");
    return saved(
      c,
      await store.save(slug, config, {
        baseVersion: current.version,
        savedBy: "admin",
        note: `Restored version ${version}`,
      }),
    );
  });

  app.get("/sites/:site/notifications", async (c) => {
    const slug = c.req.param("site");
    if (!(await configs(c).load(slug))) return notFound(c);
    const raw = c.req.query("limit");
    const limit = raw === undefined ? DELIVERY_LIMIT.default : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > DELIVERY_LIMIT.max) {
      return fail(c, 400, "invalid", `limit must be 1 to ${DELIVERY_LIMIT.max}`, {
        issues: [{ path: "limit", message: `Must be a whole number from 1 to ${DELIVERY_LIMIT.max}` }],
      });
    }
    // TODO(p6b-integration): needs migration 0006 (channel, attempts, retryable, last_attempt_at).
    const deliveries = await listDeliveries(c.var.platform.db, slug, limit);
    return c.json({ deliveries } satisfies DeliveryList);
  });

  app.get("/sites/:site/sources", async (c) => {
    const slug = c.req.param("site");
    if (!(await configs(c).load(slug))) return notFound(c);
    return c.json({ keys: await keys(c).list(slug, Date.now()) } satisfies SourceKeyList);
  });

  app.post("/sites/:site/sources", async (c) => {
    const slug = c.req.param("site");
    const store = configs(c);
    const current = await store.load(slug);
    if (!current) return notFound(c);
    const read = await readJson(c);
    if (!read.ok) return fail(c, 400, "invalid", read.message);
    const req = CreateSourceRequest.safeParse(read.body);
    if (!req.success) return fail(c, 400, "invalid", "Malformed request", { issues: flatten(req.error) });
    const { keyId, source, kind, expectedIntervalS } = req.data;
    if (sourceKindOf(source) !== kind) {
      return fail(c, 400, "invalid", "Source id prefix must match its kind", {
        issues: [{ path: "source", message: "Source id prefix must match its kind" }],
      });
    }
    const ks = keys(c);
    if (await ks.exists(keyId)) return fail(c, 409, "conflict", "Key id is taken");
    if ((await ks.list(slug, Date.now())).some((k) => k.source === source)) {
      return fail(c, 409, "conflict", "Source already has a key; rotate it instead");
    }

    let issued: Awaited<ReturnType<KeyStore["issue"]>>;
    try {
      issued = await ks.issue(slug, source, keyId, Date.now());
    } catch (err) {
      return keyFailure(c, err);
    }
    if (current.config.sources.some((s) => s.id === source)) {
      await ks.commit(issued.statement);
      return c.json(issued.issued satisfies IssuedKey, 201);
    }
    const checked = check(slug, {
      ...current.config,
      sources: [...current.config.sources, { id: source, kind, expectedIntervalS }],
    });
    if (!checked.ok) return fail(c, 400, "invalid", "Config is invalid", { issues: checked.issues });
    const out = await store.save(slug, checked.config, {
      baseVersion: current.version,
      savedBy: "admin",
      note: `Added source ${source}`,
      with: [issued.statement],
    });
    if (!out.ok) return saved(c, out);
    return c.json(issued.issued satisfies IssuedKey, 201);
  });

  app.post("/sites/:site/sources/:keyId/rotate", async (c) => {
    const slug = c.req.param("site");
    if (!(await configs(c).load(slug))) return notFound(c);
    const keyId = KeyId.safeParse(c.req.param("keyId"));
    if (!keyId.success) return fail(c, 404, "not_found", "Unknown key");
    let issued: IssuedKey | null;
    try {
      issued = await keys(c).rotate(slug, keyId.data, Date.now());
    } catch (err) {
      return keyFailure(c, err);
    }
    return issued ? c.json(issued) : fail(c, 404, "not_found", "Unknown key");
  });

  app.get("/sites/:site/api-keys", async (c) => {
    const slug = c.req.param("site");
    if (!(await configs(c).load(slug))) return notFound(c);
    return c.json({ keys: await listApiKeys(c.get("accounts").platform, slug) } satisfies ApiKeyList);
  });

  app.post("/sites/:site/api-keys", async (c) => {
    const slug = c.req.param("site");
    if (!(await configs(c).load(slug))) return notFound(c);
    const read = await readJson(c);
    if (!read.ok) return fail(c, 400, "invalid", read.message);
    const req = CreateApiKeyRequest.safeParse(read.body);
    if (!req.success) return fail(c, 400, "invalid", "Malformed request", { issues: flatten(req.error) });
    const principal = principalOf(c);
    const issued = await issueApiKey(c.get("accounts").platform, {
      site: slug,
      name: req.data.name,
      scopes: req.data.scopes,
      createdBy: principal.kind === "user" ? principal.userId : null,
    });
    return c.json(issued, 201);
  });

  app.delete("/sites/:site/api-keys/:id", async (c) => {
    const revoked = await revokeApiKey(c.get("accounts").platform, c.req.param("site"), c.req.param("id"));
    return revoked ? c.json(revoked) : fail(c, 404, "not_found", "Unknown API key");
  });

  app.post("/notify/test", async (c) => {
    const kind = TEST_CARD_KINDS.find((k) => k === c.req.query("kind"));
    if (!kind) {
      return fail(c, 400, "invalid", "kind must be stale, recovered, down or up", {
        issues: [{ path: "kind", message: "Must be stale, recovered, down or up" }],
      });
    }
    const { platform } = c.var;
    const site = c.req.query("site") ?? platform.setting("SITE_DEFAULT") ?? "";
    const channel = c.req.query("channel");
    const store = configs(c);
    if (!(await store.load(site))) return notFound(c);
    // Without a channel: the historical Discord webhook, as before channels.
    if (channel === undefined && !platform.secret("DISCORD_WEBHOOK_URL")) {
      return c.json({ error: "unavailable", message: "DISCORD_WEBHOOK_URL is not set", issues: [] }, 503);
    }
    const emailFrom = platform.setting("EMAIL_FROM");
    const out = await sendTestCard(
      {
        db: platform.db,
        configs: store,
        secret: (name) => platform.notifySecret(name),
        email: platform.email,
        ...(emailFrom ? { emailFrom } : {}),
      },
      site,
      kind,
      c.req.query("source"),
      c.req.query("service"),
      channel,
    );
    if (!out.ok) {
      const what = {
        no_service: "Unknown service",
        no_source: "Unknown source",
        no_channel: "Unknown channel",
      };
      return fail(c, 404, "not_found", what[out.error]);
    }
    const { outcome } = out;
    return c.json(
      {
        site,
        channel: out.channel,
        source: out.source,
        ...(out.service ? { service: out.service } : {}),
        kind,
        sent: outcome.ok,
        status: outcome.status,
        error: outcome.ok ? null : outcome.error,
      },
      outcome.ok ? 200 : 502,
    );
  });

  return app;
}
