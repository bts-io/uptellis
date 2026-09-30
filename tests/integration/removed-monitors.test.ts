/**
 * A native monitor removed from a site's config, end to end in workerd: its service row and history stay in
 * D1, but `/api/sites/:site/view` and the public summary stop listing it at once, and the five-minute job
 * resolves its open `down` incident with `REMOVED_MONITOR_NOTE`, sending no card.
 */
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_FIELDS, parseSiteConfig, type SiteConfig } from "@/shared/config";
import type { Heartbeat, Service } from "@/shared/model";
import { MonitorConfig } from "@/shared/monitors";
import { type AppEnv, platformContext } from "@/worker/app-env";
import { runJob } from "@/worker/cron";
import { schema } from "@/worker/db";
import { D1ConfigStore } from "@/worker/engine/config-store";
import { D1Store } from "@/worker/engine/d1-store";
import { REMOVED_MONITOR_NOTE } from "@/worker/engine/incidents";
import { KvModelCache } from "@/worker/engine/kv-cache";
import { seedConfig } from "@/worker/engine/sites";
import { appBackend } from "@/worker/index";
import { publicRoutes } from "@/worker/routes/public";
import { readRoutes } from "@/worker/routes/read";
import { fetchWith, testPlatform } from "../support/platform";

// Never a real webhook: every request to it goes to the mocked fetch below.
const HOOK = "https://discord.test/api/webhooks/1/removed";
const platform = testPlatform({ DISCORD_WEBHOOK_URL: HOOK });
const db = platform.db;
const site = "t-removed";
const T = (hms: string) => `2026-09-29T${hms}Z`;
const at = (hms: string) => Date.parse(T(hms));

afterEach(() => vi.restoreAllMocks());

const monitor = (id: string, name: string) =>
  MonitorConfig.parse({ id, name, type: "http", url: "https://example.org/" });

/** A public site with Discord down cards on, and two builtin monitors (`old-test` is removed later). */
function siteConfig(monitors: MonitorConfig[]): SiteConfig {
  const demo = seedConfig("demo")!;
  return parseSiteConfig({
    ...demo,
    slug: site,
    name: "Removed monitors",
    hostnames: ["removed.example.org"],
    visibility: "public",
    public: { enabled: true, fields: [...PUBLIC_FIELDS] },
    notify: { discord: true, channels: [] },
    sources: [{ id: "probe:cf", kind: "probe", expectedIntervalS: 60 }],
    probes: [],
    monitors,
    maintenance: [],
    sections: [{ id: "web", title: "Web", services: ["probe:checkout", "probe:old-test"] }],
    displayNames: {},
  });
}

const service = (externalId: string, name: string, status: Service["status"]): Service => ({
  id: `probe:${externalId}`,
  site,
  source: "probe:cf",
  externalId,
  name,
  kind: "http",
  targetDisplay: "example.org/",
  intervalS: 60,
  status,
  latencyMs: 90,
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

describe("a monitor removed from the config", () => {
  it("leaves the view and the public summary, and its open incident is resolved quietly", async () => {
    const configs = new D1ConfigStore(platform);
    expect(
      await configs.create(siteConfig([monitor("checkout", "Checkout"), monitor("old-test", "Old test")])),
    ).toBe(true);

    // One builtin run: checkout up, old-test down (opens its `down` incident).
    const store = new D1Store(platform);
    const applied = await store.applyDelta({
      site,
      generatedAt: T("10:00:00"),
      source: { sourceId: "probe:cf", seenAt: T("10:00:00"), ok: true, error: null },
      services: [service("checkout", "Checkout", "up"), service("old-test", "Old test", "down")],
      heartbeats: [
        beat("probe:checkout", T("09:59:58"), "up"),
        beat("probe:old-test", T("09:59:58"), "down"),
      ],
      facts: [],
    });
    const [incident] = applied.incidentsOpened;
    expect(incident).toMatchObject({ kind: "down", serviceId: "probe:old-test", endedAt: null });

    const get = routes(at("10:00:30"));
    const before = await (await get(`/api/sites/${site}/view`)).json<any>();
    expect(viewIds(before)).toEqual(["probe:checkout", "probe:old-test"]);
    expect(before.verdict.state).toBe("outage");

    // The monitor is removed from the config.
    const saved = await configs.save(site, siteConfig([monitor("checkout", "Checkout")]), {
      baseVersion: 1,
      savedBy: "admin",
    });
    expect(saved).toMatchObject({ ok: true, version: 2 });

    const view = await (await get(`/api/sites/${site}/view`)).json<any>();
    expect(viewIds(view)).toEqual(["probe:checkout"]);
    expect(view.verdict.state).toBe("operational");
    expect(view.incidents.open).toEqual([]);
    expect(JSON.stringify(view)).not.toContain("old-test");

    const summary = await get(`/api/public/${site}/summary.json`);
    expect(summary.status).toBe(200);
    const body = await summary.text();
    expect(body).toContain("probe:checkout");
    expect(body).not.toContain("old-test");
    expect((await get(`/badge/${site}/probe:old-test.svg`)).status).toBe(404);

    // The five-minute job resolves the open incident with the note, and sends no card.
    const cards: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      cards.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "1" });
    });
    const r = await runJob(platform, "fiveMinute", at("10:02:00"));
    await platform.drain();
    expect(r.resolved?.filter((i) => i.site === site)).toEqual([
      { ...incident, endedAt: T("10:02:00"), notes: REMOVED_MONITOR_NOTE },
    ]);
    expect(cards).toEqual([]);

    const [row] = await db
      .select()
      .from(schema.incidents)
      .where(and(eq(schema.incidents.site, site), eq(schema.incidents.id, incident!.id)));
    expect(row).toMatchObject({ endedAt: at("10:02:00"), notes: REMOVED_MONITOR_NOTE });
    const cached = await new KvModelCache(platform.kv).get(site);
    expect(cached?.openIncidents).toEqual([]);

    // Nothing is deleted: the service row and its heartbeats stay in the store.
    const services = await db
      .select({ id: schema.services.id })
      .from(schema.services)
      .where(eq(schema.services.site, site));
    expect(services.map((s) => s.id).sort()).toEqual(["probe:checkout", "probe:old-test"]);
    const beats = await db
      .select()
      .from(schema.heartbeats)
      .where(and(eq(schema.heartbeats.site, site), eq(schema.heartbeats.serviceId, "probe:old-test")));
    expect(beats).toHaveLength(1);

    // A second run finds nothing left to resolve.
    const again = await runJob(platform, "fiveMinute", at("10:04:00"));
    await platform.drain();
    expect(again.resolved?.filter((i) => i.site === site)).toEqual([]);
    expect(cards).toEqual([]);
  });
});
