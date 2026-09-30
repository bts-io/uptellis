import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  exportSiteConfig,
  parseSiteConfig,
  SiteConfig,
  type SiteConfigInput,
  THEME_IDS,
} from "@/shared/config";
import demo from "../../sites/demo.json";

const DEMO_PATH = fileURLToPath(new URL("../../sites/demo.json", import.meta.url));
const raw = readFileSync(DEMO_PATH, "utf8");
const DOC4 = [192, 0, 2, 10].join(".");

const minimal: SiteConfigInput = {
  v: 1,
  slug: "acme",
  name: "Acme",
  hostnames: ["status.acme.example"],
  theme: "b-control-room",
  sources: [],
  sections: [],
  branding: { title: "Acme" },
};

describe("sites/demo.json", () => {
  it("parses with SiteConfig", () => {
    const cfg = parseSiteConfig(raw);
    expect(cfg.slug).toBe("demo");
    expect(cfg.theme).toBe("a-sys-status");
    expect(cfg.sources.map((s) => [s.id, s.expectedIntervalS])).toEqual([
      ["kuma:watch-1", 60],
      ["facts:app-1", 900],
      ["probe:cf", 60],
    ]);
    expect(cfg.probes.map((p) => [p.id, p.url])).toEqual([
      ["api-health", "https://example.org/"],
      ["web-app", "https://example.com/"],
    ]);
    expect(cfg.sections.flatMap((s) => s.services)).toEqual([
      "kuma:1",
      "kuma:2",
      "probe:api-health",
      "probe:web-app",
      "kuma:3",
      "kuma:5",
      "kuma:4",
      "kuma:6",
      "kuma:8",
      "kuma:9",
    ]);
    expect(cfg.public.enabled).toBe(false);
    expect(cfg.notify.discord).toBe(false);
    expect(cfg.topology?.edges.map((e) => `${e.from}>${e.to}:${e.kind}`)).toEqual([
      "app-1>app-2:replication",
      "watch-1>app-1:watches",
    ]);
  });
  it("round-trips byte-identically (import then export)", () => {
    expect(exportSiteConfig(parseSiteConfig(raw))).toBe(raw);
    expect(exportSiteConfig(demo as SiteConfigInput)).toBe(raw);
    expect(raw.endsWith("}\n")).toBe(true);
  });
});

describe("SiteConfig", () => {
  it("fills defaults", () => {
    const cfg = SiteConfig.parse(minimal);
    expect(cfg.health).toEqual({ uptime: 0.6, latency: 0.25, cert: 0.15 });
    expect(cfg.thresholds).toEqual({
      certWarnDays: 14,
      certCritDays: 7,
      lagWarnS: 5,
      lagCritS: 60,
      backupMaxAgeH: 26,
    });
    expect(cfg.public).toEqual({ enabled: false, fields: [] });
    expect(cfg.notify).toEqual({ discord: false, webhooks: [], channels: [] });
    expect(cfg.links).toEqual([]);
    expect(cfg.displayNames).toEqual({});
    expect(cfg.branding.tokens).toEqual({});
  });
  it("exports with stable key order regardless of input order", () => {
    const shuffled = {
      branding: { tokens: { "z-accent": "#3ddc84", "a-base": "#0b0f14" }, title: "Acme" },
      displayNames: { "kuma:9": "Nine", "kuma:1": "One" },
      sections: [],
      sources: [],
      theme: "b-control-room",
      hostnames: ["status.acme.example"],
      name: "Acme",
      slug: "acme",
      v: 1,
    } as SiteConfigInput;
    const out = exportSiteConfig(shuffled);
    expect(out).toBe(exportSiteConfig(parseSiteConfig(out)));
    expect(Object.keys(JSON.parse(out))).toEqual(
      Object.keys(SiteConfig.shape).filter((k) => k !== "topology"),
    );
    expect(Object.keys(JSON.parse(out).displayNames)).toEqual(["kuma:1", "kuma:9"]);
    expect(out.startsWith('{\n  "v": 1,\n  "slug": "acme",')).toBe(true);
  });
  it("knows the nine themes", () => {
    expect(THEME_IDS).toEqual([
      "a-sys-status",
      "b-control-room",
      "c-session",
      "d-classic",
      "e-editorial",
      "f-dashboard",
      "g-wallboard",
      "h-friendly",
      "i-minimal",
    ]);
    expect(SiteConfig.safeParse({ ...minimal, theme: "d-neon" }).success).toBe(false);
  });
  it("rejects invalid configs", () => {
    const bad: [string, unknown][] = [
      ["slug", { ...minimal, slug: "Acme Co" }],
      ["no hostnames", { ...minimal, hostnames: [] }],
      ["address hostname", { ...minimal, hostnames: [DOC4] }],
      [
        "source kind mismatch",
        { ...minimal, sources: [{ id: "kuma:x", kind: "facts", expectedIntervalS: 60 }] },
      ],
      ["bad interval", { ...minimal, sources: [{ id: "kuma:x", kind: "kuma", expectedIntervalS: 0 }] }],
      ["bad service id", { ...minimal, sections: [{ id: "s", title: "S", services: ["nope"] }] }],
      ["unsafe title", { ...minimal, sections: [{ id: "s", title: `db on ${DOC4}`, services: [] }] }],
      ["address alias", { ...minimal, hostAliases: { [DOC4]: "facts-1" } }],
      ["address link", { ...minimal, links: [{ label: "x", href: `https://${DOC4}/` }] }],
      ["js link", { ...minimal, links: [{ label: "x", href: "javascript:alert(1)" }] }],
      [
        "webhook URL instead of secret name",
        { ...minimal, notify: { webhooks: ["https://hooks.example.com/x"] } },
      ],
      ["unknown public field", { ...minimal, public: { enabled: true, fields: ["emails"] } }],
      [
        "edge to unknown node",
        {
          ...minimal,
          topology: {
            nodes: [{ id: "app-1", label: "app-1", roles: ["primary"] }],
            edges: [{ from: "app-1", to: "demo-nowhere", kind: "replication" }],
          },
        },
      ],
      [
        "too many links",
        { ...minimal, links: Array.from({ length: 11 }, () => ({ label: "x", href: "https://a.example" })) },
      ],
    ];
    for (const [label, input] of bad) {
      expect(SiteConfig.safeParse(input).success, label).toBe(false);
    }
    expect(() => parseSiteConfig("{not json")).toThrow();
  });
});
