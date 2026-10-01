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

  it("names every service in the section picker, even before any check has reported", () => {
    // A fresh install: the config lists monitors, nothing has reported, so `services` is empty.
    const fresh = parseSiteConfig({
      ...demo,
      monitors: [
        {
          id: "forgejo-health",
          name: "Forgejo health",
          type: "http",
          url: "https://example.org/",
          runners: ["builtin"],
        },
      ],
      sections: [{ id: "web", title: "Web", services: ["probe:forgejo-health", "kuma:9"] }],
      displayNames: { "kuma:9": "Workers" },
    });
    mount(
      createElement(ConfigEditor, {
        site: "demo",
        state: { ...state, config: fresh },
        services: [{ id: "kuma:9", name: "kuma:9" }],
        onReload: vi.fn(),
      }),
    );
    const picker = [...document.querySelectorAll('[aria-label="Section Web"] li label')];
    const text = picker.map((l) => l.textContent?.trim());
    expect(text).toContain("Forgejo health");
    expect(text).toContain("Workers");
    // The ids stay out of the visible label (they are only the hover title).
    expect(text.some((t) => t?.includes("probe:forgejo-health"))).toBe(false);
    expect(picker.map((l) => l.getAttribute("title"))).toContain("probe:forgejo-health");
  });

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

  it("edits the visibility and the profiles from the registry, and reviews them as config changes", async () => {
    editor();
    const visibility = field("Visibility") as unknown as HTMLSelectElement;
    expect(visibility.value).toBe("public");
    expect(body()).toContain("Anyone can open the page");
    act(() => {
      visibility.value = "private";
      visibility.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(body()).toContain("Only signed-in users see the page");
    const box = (id: string) =>
      [...document.querySelectorAll("label")]
        .find((l) => l.querySelector(".font-mono")?.textContent === id)!
        .querySelector("input") as HTMLInputElement;
    expect(box("generic").checked).toBe(true);
    expect(box("generic").disabled).toBe(true);
    expect(box("forgejo-ha").checked).toBe(true);
    expect(body()).toContain("Producer install guide");
    act(() => box("uptime-kuma").click());
    expect(body()).toContain("(runs 2 of 2)");
    act(() => box("forgejo-ha").click());
    expect(box("forgejo-ha").checked).toBe(false);
    act(() => box("forgejo-ha").click());
    replies.push({ status: 200, body: { valid: true, issues: [], diff: [], version: null } });
    act(() => button("Review changes").click());
    await settle();
    expect(calls[0]!.body).toMatchObject({ visibility: "private", profiles: ["uptime-kuma", "forgejo-ha"] });
  });

  it("keeps a profile id the registry does not know visible and removable", () => {
    mount(
      createElement(ConfigEditor, {
        site: "demo",
        state: { ...state, config: { ...config, profiles: ["forgejo-ha", "gone-profile"] } },
        services,
        onReload: vi.fn(),
      }),
    );
    expect(body()).toContain("Not registered in this build");
    const gone = [...document.querySelectorAll("label")]
      .find((l) => l.querySelector(".font-mono")?.textContent === "gone-profile")!
      .querySelector("input") as HTMLInputElement;
    act(() => gone.click());
    expect(body()).not.toContain("gone-profile");
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
        inConfig: true,
      },
    ],
  };

  it("keeps a key whose source left the config, marked and rotatable", () => {
    const retired = { ...list.keys[0]!, keyId: "old-1", source: "kuma:old" as const, inConfig: false };
    mount(
      createElement(Sources, { site: "demo", list: { keys: [...list.keys, retired] }, onReload: vi.fn() }),
    );
    const rows = [...document.querySelectorAll("tbody tr")].map((r) => r.textContent ?? "");
    expect(rows[0]).not.toContain("No longer in your setup");
    expect(rows[1]).toContain("Uptime Kuma (old)");
    expect(rows[1]).toContain("No longer in your setup");
    // Sources read by kind and name, never as the raw id.
    expect(body()).not.toContain("kuma:");
    expect(button("Rotate key for Uptime Kuma (old)").disabled).toBe(false);
  });

  it("shows a rotated key's secret once, with a warning and copy, and forgets it on close", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onReload = vi.fn();
    const lastSeen = new Map([["kuma:watch-1", new Date(Date.now() - 120_000).toISOString()]]);
    mount(createElement(Sources, { site: "demo", list, lastSeen, onReload }));
    expect(body()).toContain("Uptime Kuma (watch-1)");
    expect(document.querySelector("tbody tr")?.textContent).toContain("2 minutes ago");
    expect(body()).not.toContain(SECRET);

    replies.push({
      status: 200,
      body: { keyId: "collector-1", source: "kuma:watch-1", secret: SECRET, slot: "next" },
    });
    act(() => button("Rotate key for Uptime Kuma (watch-1)").click());
    await settle();
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/admin/sites/demo/sources/collector-1/rotate",
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("This secret is shown once");
    expect(dialog.textContent).toContain("Uptime Kuma (watch-1)");
    expect(dialog.textContent).toContain("the old key keeps working until then");
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
    act(() => button("Add source").click());
    expect(calls).toHaveLength(0);
    expect(document.querySelector('[aria-invalid="true"]')).not.toBeNull();

    type(field("Key name"), "edge-2");
    type(field("Name"), "edge-2");
    replies.push({
      status: 200,
      body: { keyId: "edge-2", source: "kuma:edge-2", secret: SECRET, slot: "current" },
    });
    act(() => button("Add source").click());
    await settle();
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/admin/sites/demo/sources",
      body: { keyId: "edge-2", source: "kuma:edge-2", kind: "kuma", expectedIntervalS: 60 },
    });
    expect((field("Secret") as HTMLInputElement).value).toBe(SECRET);
  });
});
