import { describe, expect, it } from "vitest";
import {
  exportSiteConfig,
  PROBE_SOURCE_ID,
  parseSiteConfig,
  SiteConfig,
  type SiteConfigInput,
} from "@/shared/config";

const DOC4 = [192, 0, 2, 10].join(".");
const DOC6 = ["2001", "db8", "", "1"].join(":");

const minimal: SiteConfigInput = {
  v: 1,
  slug: "acme",
  name: "Acme",
  hostnames: ["status.acme.example"],
  theme: "a-sys-status",
  sources: [{ id: PROBE_SOURCE_ID, kind: "probe", expectedIntervalS: 60 }],
  sections: [{ id: "web", title: "Web", services: ["probe:home"] }],
  branding: { title: "Acme" },
};
const withProbe = (probe: Record<string, unknown>): SiteConfigInput => ({
  ...minimal,
  probes: [
    { id: "home", name: "Home", url: "https://www.acme.example/", ...probe },
  ] as SiteConfigInput["probes"],
});

describe("SiteConfig probes", () => {
  it("is optional and defaults to none", () => {
    const { probes: _, ...without } = SiteConfig.parse(minimal);
    expect(SiteConfig.parse(without).probes).toEqual([]);
    expect(SiteConfig.parse({ ...minimal, sources: [] }).probes).toEqual([]);
  });

  it("fills method, expected statuses, timeout and interval", () => {
    expect(SiteConfig.parse(withProbe({})).probes).toEqual([
      {
        id: "home",
        name: "Home",
        url: "https://www.acme.example/",
        method: "GET",
        expectStatus: { min: 200, max: 399 },
        timeoutS: 10,
        intervalS: 60,
      },
    ]);
  });

  it("rejects URLs that are not public https URLs on a hostname", () => {
    const bad = [
      "http://www.acme.example/",
      `https://${DOC4}/`,
      `https://[${DOC6}]/`,
      `https://${["user", "pass"].join(":")}@www.acme.example/`,
      "https://localhost/",
      "https://printer.local/",
      "https://app-1.tail1234.ts.net/",
      "https://db.internal/",
      `https://www.acme.example/?next=${DOC4}`,
      "ftp://www.acme.example/",
      "not a url",
    ];
    for (const url of bad) expect(SiteConfig.safeParse(withProbe({ url })).success, url).toBe(false);
    for (const url of ["https://www.acme.example/api/healthz", "https://git.acme.example:8443/x?y=1"]) {
      expect(SiteConfig.safeParse(withProbe({ url })).success, url).toBe(true);
    }
  });

  it("rejects bad fields and duplicate ids, and needs no listed probe source", () => {
    const bad: [string, SiteConfigInput][] = [
      ["method", withProbe({ method: "POST" })],
      ["id", withProbe({ id: "Home Page" })],
      ["unsafe name", withProbe({ name: `home on ${DOC4}` })],
      ["range", withProbe({ expectStatus: { min: 400, max: 200 } })],
      ["status", withProbe({ expectStatus: { min: 200, max: 700 } })],
      ["timeout", withProbe({ timeoutS: 0 })],
      ["interval", withProbe({ intervalS: 90 })],
      ["short interval", withProbe({ intervalS: 30 })],
      ["duplicate", { ...withProbe({}), probes: [...withProbe({}).probes!, ...withProbe({}).probes!] }],
    ];
    for (const [what, input] of bad) expect(SiteConfig.safeParse(input).success, what).toBe(false);
    // The builtin runner's source is implied (src/worker/engine/sites.ts), so it need not be listed.
    expect(SiteConfig.safeParse({ ...withProbe({}), sources: [] }).success).toBe(true);
  });

  it("round-trips byte-identically with probes, after sources", () => {
    const text = exportSiteConfig(withProbe({ method: "HEAD", intervalS: 300 }));
    expect(exportSiteConfig(parseSiteConfig(text))).toBe(text);
    const keys = Object.keys(JSON.parse(text));
    expect(keys.indexOf("probes")).toBe(keys.indexOf("sources") + 1);
    expect(JSON.parse(text).probes[0]).toMatchObject({ method: "HEAD", intervalS: 300 });
  });
});
