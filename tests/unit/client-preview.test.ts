import { describe, expect, it } from "vitest";
import { pageHead, withPreviewTheme } from "@/client/lib/page";
import { isRegisteredTheme, registeredThemes, THEMES, themeFor, themeHead } from "@/client/themes";
import { buildSiteView } from "@/shared/view";
import { fixtureInput } from "../fixtures/view";
import { REGISTERED } from "../support/registered-themes";

const data = { view: buildSiteView(fixtureInput("default")), commit: null };

describe("?theme= preview helpers", () => {
  it("accepts only registered theme ids", () => {
    for (const t of registeredThemes()) expect(isRegisteredTheme(t.module.id)).toBe(true);
    for (const id of ["nope", "", "__proto__", "toString", 1, null, undefined])
      expect(isRegisteredTheme(id), String(id)).toBe(false);
  });

  it("shows the preview theme and remembers the site's own, without touching the rest", () => {
    expect(withPreviewTheme(data, undefined)).toBe(data);
    expect(withPreviewTheme(data, data.view.theme)).toBe(data);
    const other = registeredThemes().find((t) => t.module.id !== data.view.theme);
    if (!other) return;
    const p = withPreviewTheme(data, other.module.id);
    expect(p.view.theme).toBe(other.module.id);
    expect(p.siteTheme).toBe(data.view.theme);
    expect(p.view.sections).toBe(data.view.sections);
    // theme-color and the font preloads follow the previewed theme in the root document (themeHead).
    expect(pageHead(p).meta).not.toContainEqual(expect.objectContaining({ name: "theme-color" }));
    expect(themeHead(themeFor(p.view.theme)).colors[0]!.content).toBe(other.themeColor);
  });

  it("keeps the SSR test's list of registered themes in sync with the registry", () => {
    const actual = Object.fromEntries(
      Object.entries(THEMES).map(([id, t]) => [
        id,
        {
          dataTheme: t!.module.dataTheme,
          themeColor: t!.themeColor,
          ...(t!.themeColorDark ? { themeColorDark: t!.themeColorDark } : {}),
          fonts: t!.fonts,
        },
      ]),
    );
    expect(REGISTERED).toEqual(actual);
  });
});

describe("theme head (theme-color and font preloads)", () => {
  it("sends one theme-color for a single-scheme theme", () => {
    expect(themeHead(themeFor("a-sys-status")).colors).toEqual([{ content: "#1d1d27" }]);
    expect(themeHead(themeFor("g-wallboard")).colors).toEqual([{ content: "#07090d" }]);
  });

  it("sends a light and a dark theme-color for the themes that follow prefers-color-scheme", () => {
    expect(themeHead(themeFor("f-dashboard")).colors).toEqual([
      { content: "#f3f5f9", media: "(prefers-color-scheme: light)" },
      { content: "#0b0e16", media: "(prefers-color-scheme: dark)" },
    ]);
    expect(themeHead(themeFor("i-minimal")).colors).toEqual([
      { content: "#ffffff", media: "(prefers-color-scheme: light)" },
      { content: "#111214", media: "(prefers-color-scheme: dark)" },
    ]);
    const dark = registeredThemes()
      .filter((t) => t.themeColorDark)
      .map((t) => t.module.id);
    expect(dark).toEqual(["f-dashboard", "i-minimal"]);
  });

  it("preloads only the shown theme's fonts: Geist for A, B and C, never for a Phase 7 theme", () => {
    for (const id of ["a-sys-status", "b-control-room", "c-session"])
      expect(themeHead(themeFor(id)).fonts).toEqual([
        "/fonts/Geist-Variable.woff2",
        "/fonts/JetBrainsMono-Variable.woff2",
      ]);
    for (const id of ["d-classic", "e-editorial", "f-dashboard", "g-wallboard", "h-friendly", "i-minimal"]) {
      const fonts = themeHead(themeFor(id)).fonts;
      expect(
        fonts.some((f) => f.includes("Geist")),
        id,
      ).toBe(false);
      expect(
        fonts.some((f) => f.includes("JetBrainsMono")),
        id,
      ).toBe(false);
    }
    expect(themeHead(themeFor("g-wallboard")).fonts).toContain("/fonts/BarlowSemiCondensed-700.woff2");
    expect(themeHead(themeFor("i-minimal")).fonts).toEqual([]);
  });

  it("names only font files that exist under public/fonts", () => {
    // Lazy glob: only the matching paths, nothing is imported.
    const files = new Set(Object.keys(import.meta.glob("/public/fonts/*.woff2")).map((f) => f.slice(7)));
    expect(files.size).toBeGreaterThan(0);
    for (const t of registeredThemes())
      for (const f of t.fonts) expect(files.has(f), `${t.module.id} ${f}`).toBe(true);
  });
});
