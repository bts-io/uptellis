/// <reference types="vite/client" />
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import demo from "../../sites/demo.json";
import { FIXTURE_NAMES, loadFixture } from "../fixtures";
import { seed } from "./seed";

const SITE_CONFIG_TEXT = JSON.stringify(demo);

// The built Worker (dist/server) with the gate armed (VIEWER_KEY from vitest.config.ts).
const get = (url: string, init?: RequestInit) => SELF.fetch(url, { redirect: "manual", ...init });

let cookie = "";
const page = (url: string) => get(url, { headers: { cookie, accept: "text/html" } });

const tag = (html: string, re: RegExp) => re.exec(html)?.[0] ?? "";
const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];

beforeAll(async () => {
  cookie = ((await get("https://example.com/?key=test-viewer-key")).headers.get("set-cookie") ?? "").split(
    ";",
  )[0]!;
  expect(cookie).toMatch(/^uptellis_view=/);
});

describe("site page", () => {
  it("renders the site's theme for the seeded data, with data-theme, title and meta", async () => {
    await seed("default");
    const res = await page("https://status.example.com/");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const html = await res.text();

    expect(tag(html, /<html[^>]*>/)).toContain('data-theme="a"');
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(titleOf(html)).toBe("DEMO status");
    expect(html.match(/name="theme-color"/g)).toHaveLength(1);
    expect(tag(html, /<meta name="theme-color"[^>]*>/)).toContain('content="#1d1d27"');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
    for (const font of ["Geist-Variable.woff2", "JetBrainsMono-Variable.woff2"])
      expect(html).toContain(`<link rel="preload" href="/fonts/${font}" as="font"`);
    const icon = /<link rel="icon" type="image\/svg\+xml" href="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(decodeURIComponent(icon)).toContain('fill="#3ddc84"');

    // The theme rendered the seeded services through the API bridge.
    for (const s of loadFixture("default").services) expect(html).toContain(s.name);
  });

  it("prefixes the title with the verdict and colours the favicon when something is down", async () => {
    await seed("incident");
    const html = await (await page("https://status.example.com/")).text();
    expect(titleOf(html)).toBe("1 down | DEMO status");
    const icon = /<link rel="icon" type="image\/svg\+xml" href="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(decodeURIComponent(icon)).toContain('fill="#ff6b6b"');
    await seed("default");
  });

  it("falls back to the default site on any other host (workers.dev, localhost)", async () => {
    for (const host of ["uptellis.example.workers.dev", "localhost:5173", "unknown.example.net"]) {
      const res = await page(`https://${host}/`);
      expect(res.status, host).toBe(200);
      expect(titleOf(await res.text()), host).toBe("DEMO status");
    }
  });

  it("answers the 404 page for an unknown path, without the dashboard", async () => {
    const res = await page("https://example.com/nope");
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Not found");
    expect(tag(html, /<html[^>]*>/)).toContain('data-theme="a"');
    expect(html).not.toContain(loadFixture("default").services[0]!.name);
  });

  it("has no /_preview in the production build, and no fixture data in the bundle", async () => {
    for (const q of ["", "?fixture=default", "?fixture=incident&theme=a-sys-status"]) {
      const res = await page(`https://example.com/_preview${q}`);
      expect(res.status, q).toBe(404);
      expect(await res.text(), q).toContain("Not found");
    }

    // Every script of the build (Worker and browser), as text: none carries fixture data.
    const files = import.meta.glob(["../../dist/server/**/*.js", "../../dist/client/**/*.js"], {
      query: "?raw",
      import: "default",
    });
    const paths = Object.keys(files);
    expect(paths.some((p) => p.endsWith("/server/index.js"))).toBe(true);
    const bundle = (await Promise.all(paths.map((p) => files[p]!() as Promise<string>))).join("\n");
    for (const name of FIXTURE_NAMES) {
      const fx = loadFixture(name);
      // Heartbeat times, cert issuers and URL targets the bundled site config does not carry (its topology
      // names the hosts, and its edge probes check the Forgejo URLs).
      const targets = fx.services.flatMap((s) =>
        s.targetDisplay?.includes("/") && !SITE_CONFIG_TEXT.includes(s.targetDisplay)
          ? [s.targetDisplay]
          : [],
      );
      const issuers = fx.services.flatMap((s) => (s.cert?.issuer ? [s.cert.issuer] : []));
      expect(issuers.length).toBeGreaterThan(0);
      for (const marker of [fx.heartbeats[0]!.ts, ...issuers, ...targets])
        expect(bundle, `${name}: ${marker}`).not.toContain(marker);
    }
  });
});
