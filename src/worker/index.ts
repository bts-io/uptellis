import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import pkg from "../../package.json";
import { type AuthEnv, authError, withPrincipal } from "./auth/context";
import { envAuthPlatform } from "./auth/env-platform";
import { buildId, commitId } from "./build";
import { D1ConfigStore } from "./engine/config-store";
import { D1Store } from "./engine/d1-store";
import { KeyStore } from "./engine/key-store";
import { KvModelCache } from "./engine/kv-cache";
import { ingestRoutes } from "./ingest/routes";
import { staleNotifier } from "./notify";
import { accountRoutes, userRoutes } from "./routes/accounts";
import { adminRoutes } from "./routes/admin";
import { readRoutes } from "./routes/read";

/**
 * The Hono app: owns /api/* and /embed/*. src/server.ts dispatches to it and SSR loaders call it in-process.
 * Every `/api/*` request but health first gets its principal (session, API key or anonymous); then ingest
 * (`/api/ingest/*`, HMAC-signed or an API key), Better Auth (`/api/auth/*`), the account routes (`/api/me`,
 * `/api/setup`, `/api/invites/*`), read (`/api/sites/*`, `page.view` per site) and admin (`/api/admin/*`,
 * a permission per route).
 */
const app = new Hono<AuthEnv>();

app.use("*", secureHeaders({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: undefined }));

app.get("/api/health", (c) =>
  c.json({ ok: true, service: "uptellis", version: pkg.version, build: buildId(), commit: commitId() }),
);

/**
 * D1 is the source of truth (models, configs, ingest keys), KV (`latest:<site>`, `config:<site>`) the
 * cache; all are cheap wrappers built per request. The notifier (ingest only) sends in the request's
 * `waitUntil`.
 */
export const d1Backend = (env: Env, ctx?: Pick<ExecutionContext, "waitUntil">) => {
  const configs = new D1ConfigStore(env.DB, env.CACHE);
  return {
    store: new D1Store(env.DB),
    cache: new KvModelCache(env.CACHE),
    configs,
    keys: new KeyStore(env.DB, env),
    notifier: staleNotifier(env, configs, { ctx }),
  };
};

app.use(
  "/api/*",
  withPrincipal((c) => envAuthPlatform(c.env)),
);

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = c.get("accounts").auth();
  return auth ? auth.handler(c.req.raw) : authError(c, 503, "unavailable", "BETTER_AUTH_SECRET is not set");
});

app.route("/api/ingest", ingestRoutes<Env>(d1Backend));
app.route("/api", accountRoutes());
app.route("/api/sites", readRoutes(d1Backend));
app.route("/api/admin", adminRoutes());
app.route("/api/admin", userRoutes());

app.notFound((c) => c.json({ error: "not_found", message: "Not found" }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: "http_error", message: err.message }, err.status);
  // The name only: messages and stacks can quote SQL or config values.
  console.error(JSON.stringify({ evt: "error", name: err instanceof Error ? err.name : "unknown" }));
  return c.json({ error: "internal", message: "Something went wrong" }, 500);
});

export default app;
