import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { THEMES } from "@/client/themes";
import { pairView, primary, standby } from "../fixtures/pair";

// Every theme renders a forgejo-ha pair with a pusher on each node: per-node disk rows, both cards.

describe("themes with both nodes pushing", () => {
  afterEach(() => vi.restoreAllMocks());
  const v = pairView([
    ...primary("app-1", "app-2", "facts:app-1", "2026-09-27T23:44:00Z"),
    ...standby("app-2", "app-1", "facts:app-2", "2026-09-27T23:46:00Z"),
  ]);

  it.each(Object.keys(THEMES))("%s renders the pair without React warnings", (id) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToStaticMarkup(
      createElement(THEMES[id as keyof typeof THEMES]!.module.Page, { view: v, commit: null }),
    );
    expect(html).toContain("app-2");
    expect(errors).not.toHaveBeenCalled();
  });
});
