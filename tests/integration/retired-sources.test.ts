/**
 * Sources removed from a site's config (retired), end to end in workerd: their service, heartbeat and fact
 * rows stay in D1, but `/api/sites/:site/view` and the public summary stop listing their services and facts
 * at once, a builtin monitor whose runner (`probe:cf`) the config only implies keeps showing, and the
 * five-minute job resolves the retired service's open `down` incident with `RETIRED_NOTE`, sending no card.
 */
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_FIELDS, parseSiteConfig, type SiteConfig } from "@/shared/config";
import type { Fact, Heartbeat, Service } from "@/shared/model";
import { MonitorConfig } from "@/shared/monitors";
import { type AppEnv, platformContext } from "@/worker/app-env";
import { runJob } from "@/worker/cron";
import { schema } from "@/worker/db";
import { D1ConfigStore } from "@/worker/engine/config-store";
import { D1Store } from "@/worker/engine/d1-store";
import { RETIRED_NOTE } from "@/worker/engine/incidents";
import { KvModelCache } from "@/worker/engine/kv-cache";
import { seedConfig } from "@/worker/engine/sites";
import { appBackend } from "@/worker/index";
import { publicRoutes } from "@/worker/routes/public";
import { readRoutes } from "@/worker/routes/read";
import { fetchWith, testPlatform } from "../support/platform";

// Never a real webhook: every request to it goes to the mocked fetch below.
const HOOK = "https://discord.test/api/webhooks/1/retired";
const platform = testPlatform({ DISCORD_WEBHOOK_URL: HOOK });
const db = platform.db;
const site = "t-retired-src";
const T = (hms: string) => `2026-09-29T${hms}Z`;
const at = (hms: string) => Date.parse(T(hms));

afterEach(() => vi.restoreAllMocks());

type Spec = SiteConfig["sources"][number];
const KUMA: Spec = { id: "kuma:watch-1", kind: "kuma", expectedIntervalS: 60 };
const FACTS: Spec = { id: "facts:app-1", kind: "facts", expectedIntervalS: 900 };
const HOOKS: Spec = { id: "webhook:deploys", kind: "webhook", expectedIntervalS: 300 };

/**
 * A public site with Discord down cards on, the listed `sources` and one builtin monitor (`checkout`)
 * whose `probe:cf` runner source is implied, never listed.
 */
function siteConfig(sources: Spec[]): SiteConfig {
  const demo = seedConfig("demo")!;
  return parseSiteConfig({
    ...demo,
    slug: site,
    name: "Retired sources",
    hostnames: ["retired.example.org"],
    visibility: "public",
    public: { enabled: true, fields: [...PUBLIC_FIELDS] },
    notify: { discord: true, channels: [] },
    sources,
    probes: [],
    monitors: [
      MonitorConfig.parse({ id: "checkout", name: "Checkout", type: "http", url: "https://example.org/" }),
    ],
    maintenance: [],
    topology: undefined,
    sections: [{ id: "web", title: "Web", services: ["kuma:1", "webhook:deploy-api", "probe:checkout"] }],
    displayNames: {},
  });
}

const service = (id: string, source: string, status: Service["status"]): Service => ({
  id,
  site,
  source,
  externalId: id.slice(id.indexOf(":") + 1),
  name: `Service ${id}`,
  kind: "http",
  targetDisplay: "example.org/",
  intervalS: 60,
  status,
  latencyMs: status === "up" ? 90 : null,
  avgLatencyMs: 90,
  uptime24h: 1,
  uptime30d: 1,
});

const beat = (serviceId: string, ts: string, status: Heartbeat["status"]): Heartbeat => ({
  site,
  serviceId,
  ts,
  status,
  latencyMs: status === "up" ? 90 : null,
  message: null,
  important: true,
});

const acceptance: Fact = {
  site,
  source: "facts:app-1",
  group: "acceptance",
  key: "check",
  value: { type: "string", value: "ok" },
  unit: null,
  severity: null,
  observedAt: T("10:00:00"),
  freshForS: 1800,
};

/** The read and public routes as src/worker/index.ts mounts them, at a fixed clock. */
function routes(nowMs: number) {
  const app = new Hono<AppEnv>().use(platformContext);
  app.route("/", publicRoutes(appBackend, { now: () => nowMs }));
  app.route("/api/sites", readRoutes(appBackend, { now: () => nowMs }));
  return (path: string) => fetchWith(app, new Request(`https://worker.example.net${path}`));
}

/** Every service id the view lists, sectioned or not. */
const viewIds = (view: { sections: { services: { id: string }[] }[]; unsectioned: { id: string }[] }) =>
  [...view.sections.flatMap((s) => s.services), ...view.unsectioned].map((s) => s.id);

describe("sources removed from the config", () => {
  it("leave the view and the public summary, and the open incident is resolved quietly", async () => {
    const configs = new D1ConfigStore(platform);
    expect(await configs.create(siteConfig([KUMA, FACTS, HOOKS]))).toBe(true);

    const store = new D1Store(platform);
    const delta = (
      source: string,
      extra: { services?: Service[]; heartbeats?: Heartbeat[]; facts?: Fact[] },
    ) =>
      store.applyDelta({
        site,
        generatedAt: T("10:00:00"),
        source: { sourceId: source, seenAt: T("10:00:00"), ok: true, error: null },
        services: extra.services ?? [],
        heartbeats: extra.heartbeats ?? [],
        facts: extra.facts ?? [],
      });
    await delta("kuma:watch-1", {
      services: [service("kuma:1", "kuma:watch-1", "up")],
      heartbeats: [beat("kuma:1", T("09:59:58"), "up")],
    });
    await delta("probe:cf", {
      services: [service("probe:checkout", "probe:cf", "up")],
      heartbeats: [beat("probe:checkout", T("09:59:58"), "up")],
    });
    await delta("facts:app-1", { facts: [acceptance] });
    // The webhook service goes down (opens its `down` incident).
    const applied = await delta("webhook:deploys", {
      services: [service("webhook:deploy-api", "webhook:deploys", "down")],
      heartbeats: [beat("webhook:deploy-api", T("09:59:58"), "down")],
    });
    const [incident] = applied.incidentsOpened;
    expect(incident).toMatchObject({ kind: "down", serviceId: "webhook:deploy-api", endedAt: null });

    const get = routes(at("10:00:30"));
    const before = await (await get(`/api/sites/${site}/view`)).json<any>();
    expect(viewIds(before)).toEqual(["kuma:1", "webhook:deploy-api", "probe:checkout"]);
    expect(before.factGroups.map((g: { id: string }) => g.id)).toContain("acceptance");
    expect(before.verdict.state).toBe("outage");

    // The webhook and the facts collector are removed from the config.
    const saved = await configs.save(site, siteConfig([KUMA]), { baseVersion: 1, savedBy: "admin" });
    expect(saved).toMatchObject({ ok: true, version: 2 });

    const view = await (await get(`/api/sites/${site}/view`)).json<any>();
    // The implied `probe:cf` runner's monitor stays.
    expect(viewIds(view)).toEqual(["kuma:1", "probe:checkout"]);
    expect(view.verdict.state).toBe("operational");
    expect(view.summary).toMatchObject({ total: 2, down: 0 });
    expect(view.incidents.open).toEqual([]);
    expect(view.factGroups).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("deploy-api");
    expect(JSON.stringify(view)).not.toContain("acceptance");

    const summary = await get(`/api/public/${site}/summary.json`);
    expect(summary.status).toBe(200);
    const body = await summary.text();
    expect(body).toContain("probe:checkout");
    expect(body).not.toContain("deploy-api");
    expect((await get(`/badge/${site}/webhook:deploy-api.svg`)).status).toBe(404);

    // The five-minute job resolves the open incident with the note, and sends no card.
    const cards: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      cards.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "1" });
    });
    const r = await runJob(platform, "fiveMinute", at("10:02:00"));
    await platform.drain();
    expect(r.resolved?.filter((i) => i.site === site)).toEqual([
      { ...incident, endedAt: T("10:02:00"), notes: RETIRED_NOTE },
    ]);
    expect(cards).toEqual([]);

    const [row] = await db
      .select()
      .from(schema.incidents)
      .where(and(eq(schema.incidents.site, site), eq(schema.incidents.id, incident!.id)));
    expect(row).toMatchObject({ endedAt: at("10:02:00"), notes: RETIRED_NOTE });
    const cached = await new KvModelCache(platform.kv).get(site);
    expect(cached?.openIncidents).toEqual([]);

    // Nothing is deleted: the service, heartbeat and fact rows stay in the store.
    const services = await db
      .select({ id: schema.services.id })
      .from(schema.services)
      .where(eq(schema.services.site, site));
    expect(services.map((s) => s.id).sort()).toEqual(["kuma:1", "probe:checkout", "webhook:deploy-api"]);
    const beats = await db
      .select()
      .from(schema.heartbeats)
      .where(and(eq(schema.heartbeats.site, site), eq(schema.heartbeats.serviceId, "webhook:deploy-api")));
    expect(beats).toHaveLength(1);
    expect(cached?.facts.map((f) => `${f.source}/${f.group}`)).toContain("facts:app-1/acceptance");

    // A second run finds nothing left to resolve.
    const again = await runJob(platform, "fiveMinute", at("10:04:00"));
    await platform.drain();
    expect(again.resolved?.filter((i) => i.site === site)).toEqual([]);
    expect(cards).toEqual([]);
  });
});
