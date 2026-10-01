// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSection,
  addService,
  catalogOf,
  draftOf,
  entryFor,
  moveService,
  previewView,
  removeSection,
  renameSection,
  setPublicName,
  stepTarget,
} from "@/client/lib/admin/statuspage/draft";
import { PUBLISH_NOTE, StatusPageScreen } from "@/client/lib/admin/statuspage/StatusPageScreen";
import { ToastProvider } from "@/client/lib/admin/Toast";
import { THEMES } from "@/client/themes";
import { parseSiteConfig, type SiteConfig } from "@/shared/config";
import type { ConfigState } from "@/shared/schemas/admin";
import { buildSiteView, type SiteView } from "@/shared/view";
import demo from "../../sites/demo.json";
import { fixtureInput } from "../fixtures/view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The demo site (sections Web, Database, Access, Workers over Kuma services; two legacy probes with no
 * data yet) plus a heartbeat, over the `default` fixture's view.
 */
const config = parseSiteConfig({
  ...demo,
  monitors: [{ id: "nightly", name: "Nightly backup", type: "push", intervalS: 86_400, graceS: 3600 }],
});
const view: SiteView = buildSiteView(fixtureInput("default"));
const state: ConfigState = { config, version: 4, savedAt: "2026-09-27T10:00:00Z", savedBy: "admin" };
/** Every service id the page could show: none may ever reach the screen's text. */
const SERVICE_IDS = [...config.sections.flatMap((s) => s.services), "probe:nightly"];

let root: Root | null = null;
let host: HTMLElement;
let calls: { method: string; path: string; body: unknown }[] = [];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit = {}) => {
      const u = new URL(String(url));
      const raw = typeof init.body === "string" ? init.body : undefined;
      const method = init.method ?? "GET";
      calls.push({ method, path: u.pathname, body: raw && JSON.parse(raw) });
      const ok = method === "PUT";
      return new Response(JSON.stringify(ok ? { version: 5, diff: [] } : { error: "not_found" }), {
        status: ok ? 200 : 404,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
function screen(v: SiteView | null = view) {
  const onDirty = vi.fn();
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(
        ToastProvider,
        null,
        createElement(StatusPageScreen, {
          site: "demo",
          state,
          view: v,
          onReload: () => {},
          onDirtyChange: onDirty,
        }),
      ),
    ),
  );
  return onDirty;
}
const $ = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = document) =>
  scope.querySelector<T & HTMLElement>(sel)!;
const button = (label: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  )!;
/** The preview in the side column (the drawer holds a second one only while open). */
const preview = () => $("aside [data-page-preview]");
const previewText = () => preview().textContent ?? "";
const sectionTitles = () =>
  [...document.querySelectorAll<HTMLInputElement>("[data-section-title]")].map((i) => i.value);
const rowNames = (section: number) =>
  [...document.querySelectorAll(`[data-section-list="${section}"] [data-row] strong`)].map(
    (s) => s.textContent,
  );
function type(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const key = (el: HTMLElement, k: string) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  });
const saved = () => calls.find((c) => c.method === "PUT")!.body as { config: SiteConfig; note: string };
const announced = () => $("[data-announce]").textContent;

describe("status page draft", () => {
  const d = draftOf(config);
  const catalog = catalogOf(config, view);

  it("adds, renames and removes sections with ids the schema accepts", () => {
    const added = addSection(d);
    expect(added.sections.at(-1)).toEqual({ id: "section-5", title: "New section", services: [] });
    expect(renameSection(added, 4, "Edge").sections[4]!.title).toBe("Edge");
    expect(removeSection(added, 0).sections.map((s) => s.title)).toEqual([
      "Database",
      "Access",
      "Workers",
      "New section",
    ]);
  });

  it("moves a service between sections, and a step past a section's end goes into the next", () => {
    const moved = moveService(d, { section: 0, index: 0 }, { section: 1, index: 1 });
    expect(moved.sections[0]!.services).toEqual(["kuma:2", "probe:api-health", "probe:web-app"]);
    expect(moved.sections[1]!.services).toEqual(["kuma:3", "kuma:1", "kuma:5"]);
    expect(stepTarget(d, { section: 0, index: 3 }, 1)).toEqual({ section: 1, index: 0 });
    expect(stepTarget(d, { section: 1, index: 0 }, -1)).toEqual({ section: 0, index: 4 });
    expect(stepTarget(d, { section: 0, index: 0 }, -1)).toBeNull();
    // Adding a placed service moves it.
    expect(addService(d, 3, "kuma:1").sections[0]!.services).not.toContain("kuma:1");
  });

  it("writes public names to displayNames, and an empty one clears it", () => {
    const e = entryFor(catalog, "kuma:3");
    const named = setPublicName(d, e, "Main database");
    expect(named.displayNames).toEqual({ "kuma:3": "Main database" });
    expect(setPublicName(named, e, "").displayNames).toEqual({});
  });

  it("names every service in the catalog by its own name, grouped by kind", () => {
    expect(catalog.filter((e) => e.group === "monitor").map((e) => e.name)).toEqual([
      "API health (edge)",
      "Web app (edge)",
    ]);
    expect(catalog.filter((e) => e.group === "heartbeat").map((e) => e.name)).toEqual(["Nightly backup"]);
    expect(catalog.find((e) => e.id === "kuma:3")!.name).toBe("Primary Postgres");
    expect(entryFor(catalog, "kuma:404").name).toBe("Unknown service");
  });

  it("rebuilds the view the way buildSiteView does: order, titles, names, leftovers unsectioned", () => {
    const d2 = setPublicName(
      renameSection(moveService(d, { section: 1, index: 1 }, { section: 0, index: 0 }), 0, "Front"),
      entryFor(catalog, "kuma:1"),
      "Public API",
    );
    const v = previewView(view, { ...removeSection(d2, 3), theme: "d-classic", title: "Acme" }, catalog);
    expect(v.theme).toBe("d-classic");
    expect(v.branding.title).toBe("Acme");
    expect(v.sections.map((s) => s.title)).toEqual(["Front", "Database", "Access"]);
    expect(v.sections[0]!.services.map((s) => s.name)).toEqual(["Replica Postgres", "Public API", "Web app"]);
    expect(v.unsectioned.map((s) => s.name)).toEqual(["Runner ping", "Runner SSH"]);
  });
});

describe("status page editor", () => {
  it("lists the sections with their services by name, and the unreported ones say so", () => {
    screen();
    expect(sectionTitles()).toEqual(["Web", "Database", "Access", "Workers"]);
    expect(rowNames(0)).toEqual(["API health", "Web app", "API health (edge)", "Web app (edge)"]);
    expect($('[data-row="0:2"]').textContent).toContain("No data yet");
    expect($("[data-off-page]").textContent).toContain("Nightly backup");
  });

  it("renames, adds and deletes (after a confirmation) sections; the preview follows", async () => {
    screen();
    type($('[data-section-title="0"]'), "Front door");
    expect(previewText()).toContain("Front door");
    act(() => button("Add section").click());
    expect(sectionTitles().at(-1)).toBe("New section");
    expect(document.activeElement).toBe($('[data-section-title="4"]'));

    act(() => button("Delete section Database").click());
    await settle();
    expect(document.body.textContent).toContain("Delete this section?");
    act(() => button("Delete section").click());
    await settle();
    expect(sectionTitles()).toEqual(["Front door", "Access", "Workers", "New section"]);
    expect(announced()).toBe("Deleted section Database.");
    expect($("[data-off-page]").textContent).toContain("Primary Postgres");
  });

  it("moves a section up, and the preview shows the new order", () => {
    screen();
    const before = previewText();
    expect(before.indexOf("Web")).toBeLessThan(before.indexOf("Database"));
    act(() => button("Move section Database up").click());
    expect(sectionTitles().slice(0, 2)).toEqual(["Database", "Web"]);
    const after = previewText();
    expect(after.indexOf("Database")).toBeLessThan(after.indexOf("Web"));
  });

  it("reorders with the keyboard on a focused handle, announced, focus kept on the moved row", () => {
    screen();
    const handle = $('[data-handle="0:1"]');
    act(() => handle.focus());
    key(handle, "ArrowUp");
    expect(rowNames(0).slice(0, 2)).toEqual(["Web app", "API health"]);
    expect(announced()).toBe("Moved Web app to position 1 of 4 in Web.");
    expect(document.activeElement).toBe($('[data-handle="0:0"]'));
    // Past the last row into the next section.
    const last = $('[data-handle="0:3"]');
    key(last, "ArrowDown");
    expect(rowNames(1)[0]).toBe("Web app (edge)");
    expect(announced()).toBe("Moved Web app (edge) to position 1 of 3 in Database.");
  });

  it("moves a service to another section by pointer drag", () => {
    screen();
    const target = $('[data-row="1:1"]');
    vi.spyOn(document, "elementFromPoint").mockReturnValue(target);
    const handle = $('[data-handle="0:0"]');
    const ev = (t: string) =>
      act(() => {
        handle.dispatchEvent(
          new MouseEvent(t, { bubbles: true, button: 0, clientX: 10, clientY: -100 }) as PointerEvent,
        );
      });
    ev("pointerdown");
    ev("pointermove");
    ev("pointerup");
    expect(rowNames(1)).toEqual(["Primary Postgres", "API health", "Replica Postgres"]);
    expect(announced()).toBe("Moved API health to position 2 of 3 in Database.");
  });

  it("writes a public name to displayNames, shows it in the preview and publishes it with a note", async () => {
    const onDirty = screen();
    expect(button("Publish changes").disabled).toBe(true);
    type($('[data-public-name="1:0"]'), "Main database");
    expect(previewText()).toContain("Main database");
    expect(previewText()).not.toContain("Primary Postgres");
    expect($("[data-unsaved]").textContent).toBe("Unsaved changes");
    expect(onDirty).toHaveBeenLastCalledWith(true);

    await act(async () => button("Publish changes").click());
    await settle();
    const body = saved();
    expect(body.note).toBe(PUBLISH_NOTE);
    expect(body.note).toBe("Updated the status page");
    expect(body.config.displayNames).toEqual({ "kuma:3": "Main database" });
    expect(body.config.sections).toEqual(config.sections);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    expect(document.querySelector("[data-unsaved]")).toBeNull();
    expect(onDirty).toHaveBeenLastCalledWith(false);
  });

  it("publishes the title, visibility, theme and sections it edited", async () => {
    screen();
    type($('input[value="Acme Cloud"]'), "Acme status");
    act(() =>
      [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
        .find((r) => r.value === "private")!
        .click(),
    );
    act(() =>
      [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
        .find((r) => r.value === "e-editorial")!
        .click(),
    );
    act(() => button("Move section Workers up").click());
    await act(async () => button("Publish changes").click());
    await settle();
    const { config: c } = saved();
    expect(c.branding.title).toBe("Acme status");
    expect(c.visibility).toBe("private");
    expect(c.theme).toBe("e-editorial");
    expect(c.sections.map((s) => s.id)).toEqual(["web", "database", "workers", "access"]);
    expect(c.monitors).toEqual(config.monitors);
  });

  it("lists services by name in the picker, grouped, marking those already on the page", () => {
    screen();
    const input = $<HTMLInputElement>('[data-picker="3"] input');
    act(() => input.focus());
    const list = document.getElementById(input.getAttribute("aria-controls")!)!;
    expect(list.hidden).toBe(false);
    const groups = [...list.querySelectorAll('[role="group"]')].map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Monitors", "Heartbeats", "Other services"]);
    const option = (name: string) =>
      [...list.querySelectorAll('[role="option"]')].find(
        (o) => o.querySelector("span")?.textContent === name,
      )!;
    expect(option("Primary Postgres").textContent).toContain("On the page in Database");
    expect(option("Primary Postgres").getAttribute("aria-disabled")).toBe("true");
    expect(option("Nightly backup").getAttribute("aria-disabled")).toBeNull();

    type(input, "night");
    expect(list.querySelectorAll('[role="option"]')).toHaveLength(1);
    key(input, "ArrowDown");
    expect(input.getAttribute("aria-activedescendant")).toBe(option("Nightly backup").id);
    key(input, "Enter");
    expect(rowNames(3)).toEqual(["Runner ping", "Runner SSH", "Nightly backup"]);
    expect(announced()).toBe("Added Nightly backup to Workers.");
    expect($("[data-off-page]").textContent).toContain("Every service is in a section.");
  });

  it("adds a service from the not-in-a-section list with one click", () => {
    screen();
    act(() => button("Take Primary Postgres out of Database").click());
    expect($("[data-off-page]").textContent).toContain("Primary Postgres");
    const quick = [...document.querySelectorAll("[data-quick-add]")].map((b) => b.textContent);
    expect(quick).toEqual(["Nightly backup(heartbeat)", "Primary Postgres"]);
    act(() => $('[data-quick-add="1"]').click());
    expect(rowNames(3)).toEqual(["Runner ping", "Runner SSH", "Primary Postgres"]);
    expect(document.querySelectorAll("[data-quick-add]")).toHaveLength(1);
  });

  it("picks a theme from the swatches; the preview takes its data-theme", () => {
    screen();
    expect(document.querySelectorAll("[data-theme-option]")).toHaveLength(9);
    expect(preview().getAttribute("data-theme")).toBe(THEMES["a-sys-status"]!.module.dataTheme);
    const d = THEMES["d-classic"]!.module;
    act(() => $<HTMLInputElement>(`[data-theme-option="${d.label}"] input`).click());
    expect(preview().getAttribute("data-theme")).toBe(d.dataTheme);
  });

  it("is a labelled region, and a click on a service jumps to its public name field", async () => {
    screen();
    const region = $('[aria-label="Preview of your status page"]');
    expect(region.contains(preview())).toBe(true);
    const card = preview().querySelector<HTMLElement>('[id="svc-kuma:5"]')!;
    act(() => card.click());
    await settle();
    expect(document.activeElement).toBe($('[data-public-name="1:1"]'));
  });

  it("never shows an internal id, in the editor or the preview", () => {
    screen();
    // Open every picker so its options render.
    for (const input of document.querySelectorAll<HTMLInputElement>("[data-picker] input"))
      act(() => input.focus());
    const editor = $("aside").previousElementSibling as HTMLElement;
    const shown = [...editor.children]
      .filter((c) => c.tagName !== "DETAILS")
      .map((c) => c.textContent)
      .join(" ");
    for (const id of SERVICE_IDS) {
      expect(shown, id).not.toContain(id);
      expect(previewText(), id).not.toContain(id);
    }
  });

  it("says so when there is no view to preview", () => {
    screen(null);
    expect(document.querySelector("[data-page-preview]")).toBeNull();
    expect(document.body.textContent).toContain("The preview shows once the page has data to show.");
  });
});
