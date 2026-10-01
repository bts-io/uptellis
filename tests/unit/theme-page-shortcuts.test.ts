// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { PageShortcutsContext } from "@/client/kit";
import { THEMES } from "@/client/themes";
import { buildSiteView } from "@/shared/view";
import { fixtureInput } from "../fixtures/view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const view = buildSiteView(fixtureInput("default"));

/** Renders theme A, focuses its first card and presses j: true when focus moved to another card. */
function jMovesFocus(shortcuts: boolean): boolean {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const page = createElement(THEMES["a-sys-status"]!.module.Page, { view, commit: null });
  act(() => root!.render(createElement(PageShortcutsContext.Provider, { value: shortcuts }, page)));
  const cards = [...document.querySelectorAll<HTMLElement>("[data-a-card]")];
  expect(cards.length).toBeGreaterThan(1);
  cards[0]!.focus();
  act(() => cards[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true })));
  return document.activeElement !== cards[0];
}

describe("page-wide shortcuts", () => {
  it("move between cards on the status page itself", () => {
    expect(jMovesFocus(true)).toBe(true);
  });

  it("are off when a theme is rendered inside the admin preview", () => {
    expect(jMovesFocus(false)).toBe(false);
  });
});
