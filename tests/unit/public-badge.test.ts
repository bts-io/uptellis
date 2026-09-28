import { describe, expect, it } from "vitest";
import type { PublicState } from "@/shared/public/summary";
import {
  BADGE_COLORS,
  escapeXml,
  formatUptime,
  renderBadge,
  textWidth,
  uptimeState,
} from "@/worker/public/badge";

/** Every element tag in order (opening, closing and self-closing), e.g. `svg`, `/title`. */
const tags = (svg: string) => [...svg.matchAll(/<(\/?[a-zA-Z]+)/g)].map((m) => m[1]);
const TAGS = tags(renderBadge({ label: "a", value: "b", state: "up" }));
const width = (svg: string) => Number(/^<svg[^>]* width="(\d+)"/.exec(svg)?.[1]);

describe("badge text widths (Verdana 11 px)", () => {
  it("grow with every character", () => {
    let prev = 0;
    for (const text of ["a", "ab", "abc", "abc ", "abc W", "abc W1", "abc W1é", "abc W1é漢"]) {
      const w = textWidth(text);
      expect(w, text).toBeGreaterThan(prev);
      prev = w;
    }
  });

  it("measure narrow and wide letters apart, digits alike", () => {
    expect(textWidth("W")).toBeGreaterThan(textWidth("i") * 3);
    expect(textWidth("0")).toBe(textWidth("8"));
    // Within a pixel of shields.io's "build | passing" badge (text 27 and 41 px wide).
    expect(Math.abs(textWidth("build") - 27)).toBeLessThan(1);
    expect(Math.abs(textWidth("passing") - 41)).toBeLessThan(1);
  });

  it("make the badge wider for a longer label or value", () => {
    const a = width(renderBadge({ label: "api", value: "up", state: "up" }));
    const b = width(renderBadge({ label: "api gateway", value: "up", state: "up" }));
    const c = width(renderBadge({ label: "api gateway", value: "maintenance", state: "maintenance" }));
    expect(a).toBeGreaterThan(20);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe("badge SVG", () => {
  it("is well-formed with label and value text", () => {
    const svg = renderBadge({ label: "Acme Cloud", value: "operational", state: "up" });
    expect(tags(svg)).toEqual(TAGS);
    expect(svg).toContain("<title>Acme Cloud: operational</title>");
    expect(svg).toContain('aria-label="Acme Cloud: operational"');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  });

  it("escapes label and value", () => {
    const svg = renderBadge({ label: `<script>&"'`, value: "</text><g onload=x>", state: "down" });
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("<g onload");
    expect(svg).toContain("&lt;script&gt;&amp;&quot;&apos;");
    expect(svg).toContain("&lt;/text&gt;&lt;g onload=x&gt;");
    // Exactly the badge's own elements, whatever the text: nothing was injected.
    expect(tags(svg)).toEqual(TAGS);
    expect(escapeXml("a\u0001b")).toBe("ab");
  });

  it("colours the value by state", () => {
    const expected: Record<PublicState, string> = {
      up: "#4c1",
      degraded: "#dfb317",
      down: "#e05d44",
      maintenance: "#007ec6",
      stale: "#9f9f9f",
      unknown: "#9f9f9f",
    };
    expect(BADGE_COLORS).toEqual(expected);
    for (const [state, color] of Object.entries(expected)) {
      const svg = renderBadge({ label: "x", value: state, state: state as PublicState });
      expect(svg, state).toContain(`fill="${color}"`);
      expect(svg, state).toContain('fill="#555"');
    }
  });

  it("cuts very long labels", () => {
    const svg = renderBadge({ label: "x".repeat(300), value: "up", state: "up" });
    expect(svg).toContain(`${"x".repeat(63)}…`);
    expect(width(svg)).toBeLessThan(600);
  });
});

describe("uptime values", () => {
  it("floor to two decimals of a percent", () => {
    expect(formatUptime(1)).toBe("100%");
    expect(formatUptime(0.99999)).toBe("99.99%");
    expect(formatUptime(0.999)).toBe("99.9%");
    expect(formatUptime(0.5)).toBe("50%");
    expect(formatUptime(0)).toBe("0%");
    expect(formatUptime(null)).toBe("no data");
  });

  it("colour by threshold", () => {
    expect(uptimeState(0.999)).toBe("up");
    expect(uptimeState(0.99)).toBe("up");
    expect(uptimeState(0.97)).toBe("degraded");
    expect(uptimeState(0.5)).toBe("down");
    expect(uptimeState(null)).toBe("unknown");
  });
});
