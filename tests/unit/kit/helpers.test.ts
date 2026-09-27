import { describe, expect, it } from "vitest";
import { secondsBetween } from "../../../src/client/effects/age-ticker";
import { DECRYPT_CHARSET, decryptFrame, settleTimes } from "../../../src/client/effects/decrypt";
import { RAIN_GLYPHS, rainColumns } from "../../../src/client/effects/matrix-rain";
import { activityTag } from "../../../src/client/kit/activity-feed";
import { ANSI_SHADOW, bannerLayers, renderAnsiShadow } from "../../../src/client/kit/ansi-shadow";
import { beatDayText } from "../../../src/client/kit/beat-bar";
import { fmtAge, fmtRatio } from "../../../src/client/kit/format";
import { litCells } from "../../../src/client/kit/gauge";
import { sparkPaths } from "../../../src/client/kit/sparkline";

// Seeded generator so random-driven helpers are testable.
const seeded = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

describe("ANSI Shadow banner", () => {
  it("matches the ANSI Shadow wordmark exactly", () => {
    expect(renderAnsiShadow("DEMO")).toBe(
      [
        "██████╗ ███████╗███╗   ███╗ ██████╗ ",
        "██╔══██╗██╔════╝████╗ ████║██╔═══██╗",
        "██║  ██║█████╗  ██╔████╔██║██║   ██║",
        "██║  ██║██╔══╝  ██║╚██╔╝██║██║   ██║",
        "██████╔╝███████╗██║ ╚═╝ ██║╚██████╔╝",
        "╚═════╝ ╚══════╝╚═╝     ╚═╝ ╚═════╝ ",
      ].join("\n"),
    );
  });

  it("has A-Z, 0-9 and space, six equal-width rows each", () => {
    expect(Object.keys(ANSI_SHADOW).sort().join("")).toBe(" 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    for (const rows of Object.values(ANSI_SHADOW)) {
      expect(rows).toHaveLength(6);
      expect(new Set(rows.map((r) => r.length)).size).toBe(1);
    }
  });

  it("uppercases and blanks unknown characters", () => {
    expect(renderAnsiShadow("demo")).toBe(renderAnsiShadow("DEMO"));
    expect(renderAnsiShadow("A-B")).toBe(renderAnsiShadow("A B"));
  });

  it("splits a frame into block, shadow and noise layers", () => {
    const art = renderAnsiShadow("OK");
    const settled = bannerLayers(art, art);
    expect(settled.noise).toBeNull();
    expect(settled.block.length).toBe(art.length);
    const mid = bannerLayers(art, `#${art.slice(1)}`);
    expect(mid.noise!.startsWith("#")).toBe(true);
    expect(mid.block[0]).toBe(" ");
    expect(mid.noise!.split("\n")).toHaveLength(6);
  });
});

describe("decrypt frames", () => {
  it("scrambles unsettled characters and keeps spaces, newlines and length", () => {
    const text = "AB CD\nEF";
    const settle = settleTimes(text, 1200, seeded(7));
    expect(settle).toHaveLength(text.length);
    expect(settle[2]).toBe(-1);
    expect(settle[5]).toBe(-1);
    const start = decryptFrame(text, settle, 0, seeded(3));
    expect(start).toHaveLength(text.length);
    expect(start[2]).toBe(" ");
    expect(start[5]).toBe("\n");
    for (const ch of start.replace(/[ \n]/g, "")) expect(DECRYPT_CHARSET).toContain(ch);
    expect(decryptFrame(text, settle, 1200, seeded(3))).toBe(text);
  });

  it("settles left to right on average", () => {
    const settle = settleTimes("X".repeat(80), 1200, seeded(11));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(settle.slice(0, 20))).toBeLessThan(avg(settle.slice(60)));
    expect(Math.max(...settle)).toBeLessThanOrEqual(1200);
  });
});

describe("rain, ages and formats", () => {
  it("lays out one column per 22.4px", () => {
    const cols = rainColumns(448, 200, seeded(5));
    expect(cols).toHaveLength(20);
    expect(cols.every((c) => c.y <= 0 && c.length >= 6 && c.length < 18)).toBe(true);
    expect(RAIN_GLYPHS).toContain("ｱ");
  });

  it("formats ages and ratios", () => {
    expect(fmtAge(34)).toBe("34s");
    expect(fmtAge(862)).toBe("14m 22s");
    expect(fmtAge(3 * 3600 + 5 * 60)).toBe("3h 5m");
    expect(fmtAge(2 * 86400 + 4 * 3600)).toBe("2d 4h");
    expect(fmtAge(-5)).toBe("0s");
    expect(fmtRatio(1)).toBe("100%");
    expect(fmtRatio(0.9931)).toBe("99.31%");
    expect(secondsBetween("2026-09-27T23:55:12Z", "2026-09-27T23:58:34Z")).toBe(202);
    expect(secondsBetween("2026-09-28T00:00:00Z", "2026-09-27T23:58:34Z")).toBe(0);
    expect(secondsBetween("not a date", "2026-09-27T23:58:34Z")).toBe(0);
  });
});

describe("pure component helpers", () => {
  it("builds the same sparkline path for the same points", () => {
    const pts = [371, 402, 389, 410, 377];
    const a = sparkPaths(pts, 300, 40)!;
    expect(a).toEqual(sparkPaths([...pts], 300, 40));
    expect(a.line.startsWith("M0.0 ")).toBe(true);
    expect(a.line.split(" L")).toHaveLength(5);
    expect(a.area.endsWith("L300.0 40 L0 40 Z")).toBe(true);
    expect(sparkPaths([], 300, 40)).toBeNull();
    // A flat or single-point series gets a unit range (no division by zero) and draws level.
    expect(sparkPaths([5], 300, 40)!.line).toBe("M0.0 15.0 L300.0 15.0");
  });

  it("counts lit gauge cells", () => {
    expect(litCells(96.8, 18)).toBe(17);
    expect(litCells(0, 10)).toBe(0);
    expect(litCells(140, 10)).toBe(10);
    expect(litCells(null, 10)).toBe(0);
  });

  it("describes a beat day", () => {
    expect(beatDayText({ day: "2026-09-15", worst: "down", uptime: 0.9931, minutesDown: 6 })).toBe(
      "2026-09-15: down · 99.31% · down 6m",
    );
    expect(beatDayText({ day: "2026-09-16", worst: "up", uptime: 1, minutesDown: 0 })).toBe(
      "2026-09-16: up · 100% · no downtime",
    );
    expect(beatDayText({ day: "2026-09-17", worst: null, uptime: null, minutesDown: 0 })).toBe(
      "2026-09-17: no data",
    );
  });

  it("tags activity rows", () => {
    const base = { id: "x", ts: "", serviceId: null, sourceId: null, title: "", message: null };
    expect(activityTag({ ...base, kind: "status", level: "crit" })).toBe("DOWN");
    expect(activityTag({ ...base, kind: "status", level: "ok" })).toBe("UP");
    expect(activityTag({ ...base, kind: "incident-open", level: "crit" })).toBe("OPEN");
    expect(activityTag({ ...base, kind: "incident-resolved", level: "ok" })).toBe("FIXED");
    expect(activityTag({ ...base, kind: "source", level: "warn" })).toBe("STALE");
  });
});
