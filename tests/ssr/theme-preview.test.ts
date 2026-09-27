import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { THEME_IDS } from "@/shared/config";
import { REGISTERED } from "../support/registered-themes";
import { seed } from "./seed";

// `?theme=<id>` on the site page of the built Worker: previews a registered theme, ignores anything else.
const OWN = REGISTERED["a-sys-status"]!;

const get = (url: string, init?: RequestInit) => SELF.fetch(url, { redirect: "manual", ...init });
let cookie = "";
const page = async (q: string) => {
  const res = await get(`https://status.example.com/${q}`, { headers: { cookie } });
  expect(res.status, q).toBe(200);
  return res.text();
};

const htmlTag = (html: string) => /<html[^>]*>/.exec(html)?.[0] ?? "";
const themeColor = (html: string) => /<meta name="theme-color" content="([^"]+)"/.exec(html)?.[1];

beforeAll(async () => {
  cookie = ((await get("https://example.com/?key=test-viewer-key")).headers.get("set-cookie") ?? "").split(
    ";",
  )[0]!;
  await seed("default");
});

describe("?theme= preview", () => {
  it.each(Object.entries(REGISTERED))("renders %s with its data-theme and theme-color", async (id, theme) => {
    const html = await page(`?theme=${id}`);
    expect(htmlTag(html)).toContain(`data-theme="${theme!.dataTheme}"`);
    expect(themeColor(html)).toBe(theme!.themeColor);
    expect(html.match(/name="theme-color"/g)).toHaveLength(1);
    // The bar shows only while the preview differs from the site's own theme (a-sys-status).
    expect(html.includes("Theme preview")).toBe(id !== "a-sys-status");
  });

  it("drops unknown or unregistered ids and renders the site's own theme", async () => {
    const unregistered = THEME_IDS.filter((id) => !REGISTERED[id]);
    for (const q of [
      "?theme=nope",
      "?theme=",
      "?theme=__proto__",
      ...unregistered.map((id) => `?theme=${id}`),
    ]) {
      // The router drops the invalid param with a redirect to the canonical URL.
      const res = await get(`https://status.example.com/${q}`, { headers: { cookie } });
      expect(res.status, q).toBe(307);
      expect(new URL(res.headers.get("location")!, "https://status.example.com").search, q).toBe("");
    }
    for (const q of ["", "?other=1"]) {
      const html = await page(q);
      expect(htmlTag(html), q).toContain(`data-theme="${OWN.dataTheme}"`);
      expect(themeColor(html), q).toBe(OWN.themeColor);
      expect(html, q).not.toContain("Theme preview");
    }
  });
});
