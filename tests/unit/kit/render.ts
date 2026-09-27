// Server rendering helpers for the kit tests: renderToString is what SSR does, so this is the markup a
// first paint (and hydration) sees.
import { createElement, type FunctionComponent } from "react";
import { renderToString } from "react-dom/server";
import { buildSiteView, type SiteView } from "../../../src/shared/view";
import type { FixtureName } from "../../fixtures";
import { fixtureInput } from "../../fixtures/view";

export const render = <P extends object>(c: FunctionComponent<P>, props: P) =>
  renderToString(createElement(c, props));

/** A detached element holding `html`, for structural queries. */
export function dom(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

export const view = (name: FixtureName): SiteView => buildSiteView(fixtureInput(name));
