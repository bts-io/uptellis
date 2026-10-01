/**
 * Which sites an instance has and which one a request gets, over D1: the bundled seed is active only when
 * `SITE_DEFAULT` names it (never listed, loaded, run by cron or served otherwise, even after an instance
 * that ran it seeded rows), and `resolveSite` (`GET /api/sites?host=`, which the page, admin and setup all
 * use) picks the hostname match, else `SITE_DEFAULT`, else the only or first-created site.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseSiteConfig } from "@/shared/config";
import { runJob } from "@/worker/cron";
import { schema } from "@/worker/db";
import { D1ConfigStore, resetConfigCache } from "@/worker/engine/config-store";
import demo from "../../sites/demo.json";
import { testPlatform } from "../support/platform";
import { adminCookie, adminEnv, handle, json, ORIGIN } from "./admin-app";

/** The instance without `SITE_DEFAULT` (a fresh install), and with other values of it. */
const envWith = (siteDefault: string) => ({ ...adminEnv, SITE_DEFAULT: siteDefault }) as Env;
const fresh = envWith("");
const off = testPlatform({ SITE_DEFAULT: "" });
const on = testPlatform({ SITE_DEFAULT: "demo" });
const T0 = Date.parse("2026-09-28T01:00:00Z");

const lookup = async (host: string, e: Env = fresh) =>
  (await json(await handle(`/api/sites?host=${encodeURIComponent(host)}`, {}, e))).site as string | null;

const newSite = (slug: string, hostnames: string[] = []) =>
  parseSiteConfig({
    v: 1,
    slug,
    name: `Site ${slug}`,
    hostnames,
    theme: "a-sys-status",
    sources: [],
    sections: [],
    branding: { title: `Site ${slug}` },
  });

/** Moves a site's version 1 to `at`, so creation order does not hang on clock ticks. */
const createdAt = (slug: string, at: number) =>
  off.db.update(schema.siteConfigs).set({ createdAt: at }).where(eq(schema.siteConfigs.site, slug));

const probes = (platform: typeof off) => {
  const fetch = vi.fn(async () => new Response(null, { status: 200 }));
  const run = runJob(platform, "probes", T0, {
    transport: { fetch: fetch as unknown as typeof globalThis.fetch, tcp: vi.fn() },
    sleep: async () => {},
    now: () => T0 + 4_000,
  });
  return { fetch, run };
};

/** Two sites created in this order: `zeta` (no hostname), then `alpha` (on its own domain); kept if there. */
async function twoSites() {
  const store = new D1ConfigStore(off);
  await store.create(newSite("zeta"));
  await store.create(newSite("alpha", ["status.alpha.example"]));
  await createdAt("zeta", T0);
  await createdAt("alpha", T0 + 60_000);
  resetConfigCache();
}

// The tests share one database, in order: a fresh install, its first site, a second, then the demo.
beforeEach(() => resetConfigCache());
afterAll(() => resetConfigCache());

describe("sites of an instance", () => {
  it("a fresh install has no site: the bundled demo is not listed, loaded, seeded or served", async () => {
    const store = new D1ConfigStore(off);
    expect(await store.slugs()).toEqual([]);
    expect(await store.current("demo")).toBeNull();
    expect(await store.load("demo")).toBeNull();
    expect(await off.db.select().from(schema.siteConfigs)).toEqual([]);
    expect(await lookup("localhost")).toBeNull();
    expect((await handle("/api/sites/demo/view", {}, fresh)).status).toBe(404);
    // Its slug stays reserved: a site of that name is refused rather than mixed up with the seed.
    expect(await store.create(parseSiteConfig(demo))).toBe(false);
  });

  it("runs no cron job for an inactive seed", async () => {
    const { fetch, run } = probes(off);
    expect((await run).probes).toMatchObject({ sites: 0, checks: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("after setup creates the first site, every lookup resolves to it, also on localhost", async () => {
    const cookie = await adminCookie();
    const res = await handle(
      "/api/admin/sites",
      {
        method: "POST",
        headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify({ config: newSite("zeta") }),
      },
      fresh,
    );
    expect(res.status).toBe(201);
    await createdAt("zeta", T0);
    resetConfigCache();
    expect(await lookup("localhost")).toBe("zeta");
    expect(await lookup(new URL(ORIGIN).hostname)).toBe("zeta");
    // The admin reads the same site (adminSite resolves through this lookup).
    const config = await handle("/api/admin/sites/zeta/config", { headers: { cookie } }, fresh);
    expect(config.status).toBe(200);
  });

  it("orders sites by creation, and picks hostname, then SITE_DEFAULT, then the first created", async () => {
    await twoSites();
    expect(await new D1ConfigStore(off).slugs()).toEqual(["zeta", "alpha"]);
    expect(await lookup("localhost")).toBe("zeta");
    expect(await lookup("STATUS.alpha.example")).toBe("alpha");
    expect(await lookup("localhost", envWith("alpha"))).toBe("alpha");
    // A SITE_DEFAULT that names no site falls back to the first created.
    expect(await lookup("localhost", envWith("nope"))).toBe("zeta");
  });

  it("with SITE_DEFAULT=demo the bundled seed is active and comes first", async () => {
    await twoSites();
    const store = new D1ConfigStore(on);
    expect(await store.slugs()).toEqual(["demo", "zeta", "alpha"]);
    expect((await store.current("demo"))?.savedBy).toBe("seed");
    const staging = envWith("demo");
    expect(await lookup("localhost", staging)).toBe("demo");
    expect(await lookup(demo.hostnames[0]!, staging)).toBe("demo");
    expect(await lookup("status.alpha.example", staging)).toBe("alpha");
    const { fetch, run } = probes(on);
    expect((await run).probes).toMatchObject({ sites: 1, checks: 2 });
    expect(fetch).toHaveBeenCalled();
  });

  it("hides the seeded demo again once SITE_DEFAULT no longer names it", async () => {
    await twoSites();
    expect(await new D1ConfigStore(on).load("demo")).not.toBeNull();
    resetConfigCache();
    const store = new D1ConfigStore(off);
    expect(await store.slugs()).toEqual(["zeta", "alpha"]);
    expect(await store.current("demo")).toBeNull();
    expect(await lookup(demo.hostnames[0]!)).toBe("zeta");
    expect((await handle("/api/sites/demo/view", {}, fresh)).status).toBe(404);
    const cookie = await adminCookie();
    expect((await handle("/api/admin/sites/demo/config", { headers: { cookie } }, fresh)).status).toBe(404);
    const { fetch, run } = probes(off);
    expect((await run).probes).toMatchObject({ checks: 0 });
    expect(fetch).not.toHaveBeenCalled();
  });
});
