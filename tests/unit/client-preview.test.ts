import { describe, expect, it } from "vitest";
import { pageHead, withPreviewTheme } from "@/client/lib/page";
import { isRegisteredTheme, registeredThemes, THEMES } from "@/client/themes";
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
    expect(pageHead(p).meta).toContainEqual({ name: "theme-color", content: other.themeColor });
  });

  it("keeps the SSR test's list of registered themes in sync with the registry", () => {
    const actual = Object.fromEntries(
      Object.entries(THEMES).map(([id, t]) => [
        id,
        { dataTheme: t!.module.dataTheme, themeColor: t!.themeColor },
      ]),
    );
    expect(REGISTERED).toEqual(actual);
  });
});
