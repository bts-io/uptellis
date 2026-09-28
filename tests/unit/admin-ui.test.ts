// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigEditor, validateConfig } from "@/client/lib/admin/ConfigEditor";
import { Sources } from "@/client/lib/admin/Sources";
import { parseSiteConfig } from "@/shared/config";
import type { ConfigState, SourceKeyList } from "@/shared/schemas/admin";
import demo from "../../sites/demo.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config = parseSiteConfig(demo);
const state: ConfigState = { config, version: 4, savedAt: "2026-09-27T10:00:00Z", savedBy: "admin" };
const services = config.sections.flatMap((s) => s.services).map((id) => ({ id, name: `Service ${id}` }));

/** A secret-shaped value built at run time (the repo scan rejects token literals). */
const SECRET = Array.from({ length: 44 }, (_, i) => "abcdefghijklmnopqrstuvwxyz"[i % 26]).join("");

let root: Root | null = null;
let host: HTMLElement;
let calls: { method: string; path: string; body: unknown }[] = [];
let replies: { status: number; body: unknown }[] = [];

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  calls = [];
  replies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit = {}) => {
      const u = new URL(String(url));
      const raw = typeof init.body === "string" ? init.body : undefined;
      calls.push({ method: init.method ?? "GET", path: u.pathname + u.search, body: raw && JSON.parse(raw) });
      const r = replies.shift() ?? { status: 500, body: { error: "http_error", message: "no reply queued" } };
      return new Response(JSON.stringify(r.body), {
        status: r.status,
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

const mount = (el: ReturnType<typeof createElement>) => {
  root = createRoot(host);
  act(() => root!.render(el));
};
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
const button = (label: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  )!;
const field = (label: string) => {
  const l = [...document.querySelectorAll("label")].find((x) => x.textContent === label)!;
  return document.getElementById(l.htmlFor) as HTMLInputElement | HTMLTextAreaElement;
};
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const body = () => document.body.textContent ?? "";

describe("config validation", () => {
  it("accepts the committed config and reports issues with dotted paths", () => {
    expect(validateConfig(config)).toEqual([]);
    const issues = validateConfig({ ...config, sections: [{ ...config.sections[0]!, id: "Bad Id" }] });
    expect(issues.map((i) => i.path)).toContain("sections.0.id");
  });
});

describe("config editor", () => {
  const editor = (onReload = vi.fn()) =>
    mount(createElement(ConfigEditor, { site: "demo", state, services, onReload }));

  it("shows issues inline as you type and blocks review until they are fixed", () => {
    editor();
    const name = field("Name") as HTMLInputElement;
    type(name, "x".repeat(81));
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(body()).toContain("1 field needs attention");
    expect(button("Review changes").disabled).toBe(true);
    type(name, "Acme");
    expect(name.getAttribute("aria-invalid")).toBeNull();
    expect(button("Review changes").disabled).toBe(false);
  });

  it("reviews the server's dry-run diff, then saves against the version it started from", async () => {
    const onReload = vi.fn();
    editor(onReload);
    type(field("Name"), "Acme Renamed");
    replies.push({
      status: 200,
      body: {
        valid: true,
        issues: [],
        diff: [{ path: "name", op: "change", before: config.name, after: "Acme Renamed" }],
        version: null,
      },
    });
    act(() => button("Review changes").click());
    await settle();
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/admin/sites/demo/config/import?dryRun=1" });
    expect((calls[0]!.body as { name: string }).name).toBe("Acme Renamed");
    expect(document.querySelector("table")!.textContent).toContain('"Acme Renamed"');

    type(field("Note (optional, shown in revisions)"), "rename");
    replies.push({ status: 200, body: { version: 5, diff: [] } });
    act(() => button("Save as version 5").click());
    await settle();
    expect(calls[1]).toMatchObject({
      method: "PUT",
      path: "/api/admin/sites/demo/config",
      body: { baseVersion: 4, note: "rename" },
    });
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("says who got there first on a 409 and offers a reload", async () => {
    const onReload = vi.fn();
    editor(onReload);
    type(field("Name"), "Late edit");
    replies.push({
      status: 200,
      body: { valid: true, issues: [], diff: [{ path: "name", op: "change" }], version: null },
    });
    act(() => button("Review changes").click());
    await settle();
    replies.push({
      status: 409,
      body: { error: "conflict", message: "Version 6 is newer", issues: [], currentVersion: 6 },
    });
    act(() => button("Save as version 5").click());
    await settle();
    expect(body()).toContain("Someone saved version 6 while you were editing");
    act(() => button("Reload version 6").click());
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("edits the visibility and the profile list, and reviews them as config changes", async () => {
    editor();
    const visibility = field("Visibility") as unknown as HTMLSelectElement;
    expect(visibility.value).toBe("public");
    expect(body()).toContain("Anyone can open the page");
    act(() => {
      visibility.value = "private";
      visibility.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(body()).toContain("Only signed-in users see the page");
    const profiles = field("Profile ids, in order") as HTMLInputElement;
    expect(profiles.value).toBe("forgejo-ha");
    type(profiles, "forgejo-ha, ");
    expect(profiles.value).toBe("forgejo-ha, ");
    type(profiles, "forgejo-ha, Not A Profile");
    expect(profiles.getAttribute("aria-invalid")).toBe("true");
    type(profiles, "forgejo-ha, my-db");
    replies.push({ status: 200, body: { valid: true, issues: [], diff: [], version: null } });
    act(() => button("Review changes").click());
    await settle();
    expect(calls[0]!.body).toMatchObject({ visibility: "private", profiles: ["forgejo-ha", "my-db"] });
  });

  it("edits the raw JSON with parse and schema errors, and back in the form", () => {
    editor();
    act(() => button("JSON").click());
    const json = document.getElementById("config-json") as HTMLTextAreaElement;
    expect(JSON.parse(json.value)).toEqual(config);
    type(json, "{ not json");
    expect(body()).toContain("JSON:");
    expect(button("Form").disabled).toBe(true);
    type(json, JSON.stringify({ ...config, slug: "Not A Slug" }));
    expect(body()).toContain("slug");
    expect(button("Form").disabled).toBe(true);
    type(json, JSON.stringify({ ...config, name: "From JSON" }));
    act(() => button("Form").click());
    expect((field("Name") as HTMLInputElement).value).toBe("From JSON");
  });
});

describe("sources and the one-time secret", () => {
  const list: SourceKeyList = {
    keys: [
      {
        keyId: "collector-1",
        source: "kuma:watch-1",
        kind: "kuma",
        store: "d1",
        current: { createdAt: "2026-09-01T00:00:00Z", lastUsedAt: "2026-09-27T09:00:00Z" },
        next: null,
      },
    ],
  };

  it("shows a rotated key's secret once, with a warning and copy, and forgets it on close", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onReload = vi.fn();
    mount(createElement(Sources, { site: "demo", list, onReload }));
    expect(body()).toContain("collector-1");
    expect(body()).not.toContain(SECRET);

    replies.push({
      status: 200,
      body: { keyId: "collector-1", source: "kuma:watch-1", secret: SECRET, slot: "next" },
    });
    act(() => button("Rotate collector-1").click());
    await settle();
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/admin/sites/demo/sources/collector-1/rotate",
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("This secret is shown once");
    expect((field("Secret") as HTMLInputElement).value).toBe(SECRET);

    act(() => button("Copy secret").click());
    await settle();
    expect(writeText).toHaveBeenCalledWith(SECRET);
    expect(dialog.textContent).toContain("Copied.");

    act(() => button("Done").click());
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain(SECRET);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("validates a new source before asking, then shows its first key", async () => {
    mount(createElement(Sources, { site: "demo", list, onReload: vi.fn() }));
    act(() => button("Create source").click());
    expect(calls).toHaveLength(0);
    expect(document.querySelector('[aria-invalid="true"]')).not.toBeNull();

    type(field("Key id"), "edge-2");
    type(field("Source name (kuma:name)"), "edge-2");
    replies.push({
      status: 200,
      body: { keyId: "edge-2", source: "kuma:edge-2", secret: SECRET, slot: "current" },
    });
    act(() => button("Create source").click());
    await settle();
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/admin/sites/demo/sources",
      body: { keyId: "edge-2", source: "kuma:edge-2", kind: "kuma", expectedIntervalS: 60 },
    });
    expect((field("Secret") as HTMLInputElement).value).toBe(SECRET);
  });
});
