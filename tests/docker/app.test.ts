/**
 * The app on the Docker platform: the same Hono API and jobs as on Cloudflare, over SQLite. A signed Kuma
 * snapshot and facts go in, the view comes out, the admin API saves a config revision, and the five-minute
 * and daily jobs run.
 */
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { runJob } from "@/worker/cron";
import { schema } from "@/worker/db";
import { resetConfigCache } from "@/worker/engine/config-store";
import app from "@/worker/index";
import { envIngestKeys } from "@/worker/ingest/keys";
import { loadFixture } from "../fixtures";
import { factsPayloadFrom, kumaSnapshotFrom } from "../support/fixture-payloads";
import { signedPost, TEST_ENV } from "../support/signing";
import { type TempPlatform, tempPlatform } from "./support";

const fx = loadFixture("default");
const NOW = Date.parse(fx.now);
const ORIGIN = "https://status.example.com";
let t: TempPlatform;

const send = async (path: string, init: RequestInit = {}) => {
  const res = await app.fetch(new Request(`${ORIGIN}${path}`, init), {
    platform: t.platform,
    envIngestKeys: envIngestKeys(TEST_ENV),
  });
  await t.platform.drain();
  return res;
};

beforeAll(() => {
  resetConfigCache();
  t = tempPlatform({ SITE_DEFAULT: "demo" }, NOW);
  spyOn(console, "log").mockImplementation(() => {});
});
afterAll(() => t.dispose());

describe("the API on SQLite", () => {
  it("answers health", async () => {
    const res = await send("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: "uptellis" });
  });

  it("ingests signed payloads and serves the model and the view", async () => {
    const kuma = JSON.stringify(kumaSnapshotFrom(fx));
    const k = await send("/api/ingest/kuma", await signedPost("/api/ingest/kuma", kuma));
    expect(k.status).toBe(202);
    const facts = JSON.stringify(factsPayloadFrom(fx));
    const f = await send(
      "/api/ingest/facts",
      await signedPost("/api/ingest/facts", facts, { keyId: "facts-1" }),
    );
    expect(f.status).toBe(202);

    const model = (await (await send("/api/sites/demo/model")).json()) as { services: unknown[] };
    expect(model.services.length).toBe(fx.services.filter((s) => s.source === "kuma:watch-1").length);
    expect(await t.platform.kv.get("latest:demo")).not.toBeNull();
    const view = await send("/api/sites/demo/view");
    expect(view.status).toBe(200);
    expect(((await view.json()) as { site: { slug: string } }).site.slug).toBe("demo");
  });

  it("saves a config revision through the admin API", async () => {
    const current = (await (await send("/api/admin/sites/demo/config")).json()) as {
      version: number;
      config: { name: string };
    };
    const res = await send("/api/admin/sites/demo/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseVersion: current.version,
        config: { ...current.config, name: "Acme Cloud Docker" },
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { version: number }).version).toBe(current.version + 1);
    const rows = await t.platform.db
      .select()
      .from(schema.siteConfigs)
      .where(eq(schema.siteConfigs.site, "demo"));
    expect(rows.length).toBe(current.version + 1);
  });

  it("runs the five-minute and daily jobs", async () => {
    const five = await runJob(t.platform, "fiveMinute", Date.now());
    expect(five.job).toBe("fiveMinute");
    expect(five.downsampled).toBeDefined();
    await t.platform.kv.put("gone", 1, { ttlS: 1 });
    t.clock.now = Date.now() + 5_000;
    const daily = await runJob(t.platform, "daily", t.clock.now);
    expect(daily.pruned?.kv).toBeGreaterThanOrEqual(1);
  });
});
