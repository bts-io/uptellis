// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeys } from "@/client/lib/admin/ApiKeys";
import { ImportExport } from "@/client/lib/admin/ImportExport";
import { Revisions } from "@/client/lib/admin/Revisions";
import { AdvancedEditor } from "@/client/lib/admin/settings/Advanced";
import { SOURCE_KIND_NAME, sourceLabel } from "@/client/lib/admin/settings/labels";
import { SettingsSection } from "@/client/lib/admin/settings/Section";
import { Users } from "@/client/lib/admin/Users";
import { parseSiteConfig } from "@/shared/config";
import { SOURCE_KINDS } from "@/shared/model";
import type { ConfigState, RevisionList } from "@/shared/schemas/admin";
import type { UserSummary } from "@/shared/schemas/auth";
import demo from "../../sites/demo.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config = parseSiteConfig(demo);
const state: ConfigState = { config, version: 4, savedAt: "2026-09-27T10:00:00Z", savedBy: "admin" };
const mail = (local: string) => [local, "example.org"].join("@");

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
      calls.push({ method: init.method ?? "GET", path: u.pathname + u.search, body: raw });
      const r = replies.shift() ?? { status: 500, body: { error: "http_error", message: "no reply queued" } };
      return Response.json(r.body, { status: r.status });
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
const text = () => document.body.textContent ?? "";

describe("settings sections", () => {
  it("head each section with an h2 and a plain subtitle", () => {
    mount(
      createElement(
        SettingsSection,
        {
          title: "Revisions",
          subtitle: "Every save is kept.",
        },
        createElement("p", null, "body"),
      ),
    );
    const section = document.querySelector("section")!;
    expect(document.getElementById(section.getAttribute("aria-labelledby")!)?.tagName).toBe("H2");
    expect(section.textContent).toContain("Every save is kept.");
  });

  it("names sources by kind and name, never by raw id", () => {
    expect(sourceLabel("kuma:watch-1")).toBe("Uptime Kuma (watch-1)");
    expect(sourceLabel("facts:app-1")).toBe("Facts collector (app-1)");
    expect(sourceLabel("other")).toBe("other");
    expect(Object.keys(SOURCE_KIND_NAME).sort()).toEqual([...SOURCE_KINDS].sort());
  });
});

describe("revisions", () => {
  const list: RevisionList = {
    current: 3,
    revisions: [
      {
        version: 2,
        savedAt: "2026-09-26T10:00:00Z",
        savedBy: "Sam",
        note: "Added alert channel Ops Slack",
        changes: 1,
      },
      { version: 3, savedAt: "2026-09-27T10:00:00Z", savedBy: "Sam", note: null, changes: 2 },
    ],
  };

  it("lists saves newest first in words and restores one after confirming", async () => {
    const onReload = vi.fn();
    mount(createElement(Revisions, { site: "demo", list, onReload }));
    const items = [...document.querySelectorAll("li[data-revision]")].map((l) => l.textContent ?? "");
    expect(items[0]).toContain("Saved without a note");
    expect(items[0]).toContain("live now");
    expect(items[1]).toContain("Added alert channel Ops Slack");
    expect(items[1]).toContain("by Sam");
    expect(button("Restore version 3")).toBeUndefined();

    act(() => button("Restore version 2").click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Nothing is lost");
    expect(calls).toHaveLength(0);
    replies.push({ status: 200, body: { version: 4, diff: [] } });
    const confirm = [...document.querySelectorAll('[role="dialog"] button')].find(
      (b) => b.textContent === "Restore",
    ) as HTMLButtonElement;
    act(() => confirm.click());
    await settle();
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/admin/sites/demo/config/revisions/2/restore",
    });
    expect(text()).toContain("Restored version 2 as version 4.");
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe("import and export", () => {
  it("downloads the setup and imports a file only after showing what changes", async () => {
    const onReload = vi.fn();
    mount(createElement(ImportExport, { site: "demo", onReload }));
    const link = document.querySelector("a[download]") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/admin/sites/demo/config/export");
    expect(link.textContent).toBe("Download demo.json");

    const input = document.getElementById("import-file") as HTMLInputElement;
    const file = new File([JSON.stringify({ ...config, name: "Acme Renamed" })], "demo.json", {
      type: "application/json",
    });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    replies.push({
      status: 200,
      body: {
        valid: true,
        issues: [],
        diff: [{ path: "name", op: "change", before: "Acme", after: "Acme Renamed" }],
        version: null,
      },
    });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();
    expect(calls[0]).toMatchObject({ method: "POST", path: "/api/admin/sites/demo/config/import?dryRun=1" });
    expect(text()).toContain("What demo.json would change");

    replies.push({ status: 200, body: { valid: true, issues: [], diff: [], version: 5 } });
    act(() => button("Import demo.json").click());
    await settle();
    expect(calls[1]).toMatchObject({ method: "POST", path: "/api/admin/sites/demo/config/import" });
    expect(text()).toContain("Imported as version 5.");
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe("advanced", () => {
  it("folds the full editor under Edit config as JSON, with a warning", () => {
    mount(createElement(AdvancedEditor, { site: "demo", state, view: null, onReload: vi.fn() }));
    const details = document.querySelector("details[data-advanced]") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toContain("Edit config as JSON");
    expect(details.querySelector('[role="note"]')?.textContent).toContain(
      "Changes here skip the guided pages",
    );
    // The full editor with its form and JSON tabs is inside.
    expect(button("JSON")).toBeDefined();
    expect(button("Review changes")).toBeDefined();
  });
});

describe("keys and people in plain words", () => {
  it("names API key abilities in words", () => {
    mount(
      createElement(ApiKeys, {
        site: "demo",
        onReload: vi.fn(),
        list: {
          keys: [
            {
              id: "k1",
              site: "demo",
              name: "facts pusher",
              scopes: ["ingest", "agent"],
              prefix: "upt_k1",
              createdAt: "2026-09-01T00:00:00Z",
              createdBy: "o1",
              lastUsedAt: null,
              revokedAt: null,
            },
          ],
        },
      }),
    );
    expect(text()).toContain("Can: Send data, Run checks.");
  });

  it("shows roles by name and invites as links that work once", () => {
    const owner: UserSummary = {
      id: "o1",
      name: "Site Owner",
      email: mail("owner"),
      image: null,
      role: "owner",
      createdAt: "2026-09-01T00:00:00Z",
    };
    mount(
      createElement(Users, {
        me: owner,
        users: { users: [{ ...owner, lastSignInAt: null }] },
        invites: { invites: [] },
        onReload: vi.fn(),
      }),
    );
    const role = document.querySelector("select") as HTMLSelectElement;
    expect([...role.options].map((o) => o.textContent)).toEqual(["Owner", "Admin", "Viewer"]);
    expect(text()).toContain("An invite is a link that works once.");
    expect(text()).toContain("No open invites.");
  });
});
