/**
 * The public endpoints on the Docker platform: the same Hono routes over SQLite, with the demo site
 * published through a saved config revision.
 */
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { PUBLIC_FIELDS } from "@/shared/config";
import { PublicSummary } from "@/shared/public/summary";
import { isWorkerOwned } from "@/worker/build";
import { D1ConfigStore, resetConfigCache } from "@/worker/engine/config-store";
import app from "@/worker/index";
import { envIngestKeys } from "@/worker/ingest/keys";
import { loadFixture } from "../fixtures";
import { kumaSnapshotFrom } from "../support/fixture-payloads";
import { signedPost, TEST_ENV } from "../support/signing";
import { type TempPlatform, tempPlatform } from "./support";

const fx = loadFixture("default");
const NOW = Date.parse(fx.now);
const ORIGIN = "https://status.example.com";
let t: TempPlatform;

const send = async (path: string, init: RequestInit = {}) => {
  expect(isWorkerOwned(new URL(path, ORIGIN).pathname)).toBe(true);
  const res = await app.fetch(new Request(`${ORIGIN}${path}`, init), {
    platform: t.platform,
    envIngestKeys: envIngestKeys(TEST_ENV),
  });
  await t.platform.drain();
  return res;
};

beforeAll(async () => {
  resetConfigCache();
  t = tempPlatform({ SITE_DEFAULT: "demo" }, NOW);
  spyOn(console, "log").mockImplementation(() => {});
  const kuma = JSON.stringify(kumaSnapshotFrom(fx));
  expect((await send("/api/ingest/kuma", await signedPost("/api/ingest/kuma", kuma))).status).toBe(202);
});
afterAll(() => {
  resetConfigCache();
  t.dispose();
});

describe("public endpoints on SQLite", () => {
  it("are 404 while the site is not published", async () => {
    for (const path of ["/api/public/demo/summary.json", "/badge/demo.svg", "/embed/demo"]) {
      expect((await send(path)).status, path).toBe(404);
    }
    expect((await send("/embed.js")).status).toBe(200);
  });

  it("serve the summary, badges and widget once published", async () => {
    const configs = new D1ConfigStore(t.platform);
    const current = (await configs.current("demo"))!;
    const saved = await configs.save(
      "demo",
      { ...current.config, public: { enabled: true, fields: [...PUBLIC_FIELDS] } },
      { baseVersion: current.version, savedBy: "admin" },
    );
    expect(saved.ok).toBe(true);

    const summary = await send("/api/public/demo/summary.json");
    expect(summary.status).toBe(200);
    expect(summary.headers.get("access-control-allow-origin")).toBe("*");
    const body = PublicSummary.parse(await summary.json());
    expect(body.site.slug).toBe("demo");
    expect(body.sections?.flatMap((s) => s.services).length).toBeGreaterThan(0);

    const badge = await send("/badge/demo.svg");
    expect(badge.status).toBe(200);
    expect(badge.headers.get("content-type")).toBe("image/svg+xml");
    expect(await badge.text()).toStartWith("<svg");

    const embed = await send("/embed/demo");
    expect(embed.status).toBe(200);
    expect(await embed.text()).toContain(body.site.name);
  });
});
