/**
 * The committed seed of a private deployment: `sites/demo.json` replaced by its own site (here slug `acme`)
 * and `SITE_DEFAULT` set to that slug. The seed is active by its slug, whatever the file is called, and
 * `resolveSite` picks it like any site. The D1 side (listing, cron, admin, serving) is in
 * tests/integration/sites.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import type { SiteConfig } from "@/shared/config";
import { activeSeed, type ConfigSource, inactiveSeed, resolveSite, seedSlugs } from "@/worker/engine/sites";

vi.mock("../../sites/demo.json", async (importOriginal) => {
  const real = ((await importOriginal()) as { default: Record<string, unknown> }).default;
  return { default: { ...real, slug: "acme", name: "Acme Status", hostnames: ["status.acme.example"] } };
});

/** A config source over plain configs, listed in the given order. */
const source = (configs: Pick<SiteConfig, "slug" | "hostnames">[]): ConfigSource => ({
  current: async (slug) => {
    const config = configs.find((c) => c.slug === slug);
    return config
      ? { config: config as SiteConfig, version: 1, savedAt: "2026-09-28T00:00:00Z", savedBy: "seed" }
      : null;
  },
  slugs: async () => configs.map((c) => c.slug),
});

describe("bundled seed", () => {
  it("is active only when SITE_DEFAULT names its slug, also when the file was replaced", () => {
    expect(seedSlugs()).toEqual(["acme"]);
    expect(activeSeed("acme")?.name).toBe("Acme Status");
    expect(activeSeed(undefined)).toBeNull();
    expect(activeSeed("demo")).toBeNull();
    expect(inactiveSeed("acme", "acme")).toBe(false);
    expect(inactiveSeed("acme", undefined)).toBe(true);
    // Any other slug is not a seed at all, so never hidden.
    expect(inactiveSeed("demo", undefined)).toBe(false);
  });
});

describe("resolveSite", () => {
  const sites = source([
    { slug: "first", hostnames: [] },
    { slug: "second", hostnames: ["status.second.example"] },
  ]);

  it("picks the hostname match, then SITE_DEFAULT, then the first listed", async () => {
    expect(await resolveSite(sites, "Status.Second.Example", undefined)).toBe("second");
    expect(await resolveSite(sites, "localhost", "second")).toBe("second");
    expect(await resolveSite(sites, "localhost", undefined)).toBe("first");
    expect(await resolveSite(sites, "localhost", "missing")).toBe("first");
  });

  it("uses the only site on any host, and answers null with none", async () => {
    expect(await resolveSite(source([{ slug: "only", hostnames: [] }]), "localhost", undefined)).toBe("only");
    expect(await resolveSite(source([]), "localhost", "demo")).toBeNull();
  });
});
