import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type { Platform } from "@/platform/types";
import { AGENT_API_PREFIX } from "@/shared/monitors";
import pkg from "../../package.json";
import { type AppEnv, platformContext } from "./app-env";
import { authError, withPrincipal } from "./auth/context";
import { buildId, commitId } from "./build";
import { D1ConfigStore } from "./engine/config-store";
import { D1Store } from "./engine/d1-store";
import { KeyStore } from "./engine/key-store";
import { KvModelCache } from "./engine/kv-cache";
import { ingestRoutes } from "./ingest/routes";
import { SqlRunnerStates } from "./monitors/runner-state";
import { incidentNotifier } from "./notify";
import { accountRoutes, userRoutes } from "./routes/accounts";
import { adminRoutes } from "./routes/admin";
import { agentRoutes } from "./routes/agent";
import { publicRoutes } from "./routes/public";
import { pushRoutes } from "./routes/push";
import { readRoutes } from "./routes/read";

/**
 * The Hono app: owns /api/*, /badge/*, /embed/* and /embed.js. src/worker/serve.ts dispatches to it with
 * the request's `AppBindings` (./app-env.ts), and SSR loaders call it in-process. The public endpoints
 * (`/api/public/*`, badges and the widget, ./routes/public.ts) and the push URLs of push monitors
 * (`/api/push/<token>`, ./routes/push.ts, where the token is the credential) are anonymous and come first; every other
 * `/api/*` request but health first gets its principal (session, API key or anonymous); then ingest (`/api/ingest/*`, HMAC-signed or an API
 * key), the agent API (`/api/agent/v1/*`, an API key with the `agent` scope), Better Auth (`/api/auth/*`),
 * the account routes (`/api/me`, `/api/setup`, `/api/invites/*`), read (`/api/sites/*`, `page.view` per
 * site) and admin (`/api/admin/*`, a permission per route).
 */
const app = new Hono<AppEnv>();

app.use("*", platformContext);
app.use("*", secureHeaders({ crossOriginEmbedderPolicy: false, contentSecurityPolicy: undefined }));

app.get("/api/health", (c) =>
  c.json({ ok: true, service: "uptellis", version: pkg.version, build: buildId(), commit: commitId() }),
);

/**
 * The SQL database is the source of truth (models, configs, ingest keys), the key-value cache
 * (`latest:<site>`, `config:<site>`) the cache; all are cheap wrappers built per request. The notifier
 * (ingest only) sends in the platform's `waitUntil`.
 */
export const appBackend = (platform: Platform) => {
  const configs = new D1ConfigStore(platform);
  return {
    store: new D1Store(platform),
    cache: new KvModelCache(platform.kv),
    configs,
    keys: new KeyStore(platform),
    notifier: incidentNotifier(platform, configs),
    runtime: platform.runtime,
  };
};

/** `appBackend` plus the monitors' runner states (the agent API). */
export const monitorsBackend = (platform: Platform) => ({
  ...appBackend(platform),
  runners: new SqlRunnerStates(platform),
});

// Anonymous by design: mounted before the principal middleware, so no session or key is ever looked at.
app.route("/", publicRoutes(appBackend));
app.route("/api/push", pushRoutes(monitorsBackend));

app.use("/api/*", withPrincipal);

app.on(["GET", "POST"], "/api/auth/*", (c) => {
  const auth = c.get("accounts").auth();
  return auth ? auth.handler(c.req.raw) : authError(c, 503, "unavailable", "BETTER_AUTH_SECRET is not set");
});

app.route("/api/ingest", ingestRoutes(appBackend));
app.route(AGENT_API_PREFIX, agentRoutes(monitorsBackend));
app.route("/api", accountRoutes());
app.route("/api/sites", readRoutes(appBackend));
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
