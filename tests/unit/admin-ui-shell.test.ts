// @vitest-environment happy-dom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  isRedirect,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Drawer } from "@/client/lib/admin/Drawer";
import { AdminLayout } from "@/client/lib/admin/Layout";
import { ADMIN_TABS, LEGACY_ADMIN_REDIRECTS } from "@/client/lib/admin/nav";
import { STATE_WORD, StatePill } from "@/client/lib/admin/StatePill";
import { ToastProvider, useToast } from "@/client/lib/admin/Toast";
import {
  CONFLICT_MESSAGE,
  type SaveOutcome,
  saveChange,
  useSiteConfig,
} from "@/client/lib/admin/useSiteConfig";
import { Route as FilesRoute } from "@/client/routes/admin/files";
import { Route as RevisionsRoute } from "@/client/routes/admin/revisions";
import { Route as SourcesRoute } from "@/client/routes/admin/sources";
import { Route as ThemesRoute } from "@/client/routes/admin/themes";
import { Route as UsersRoute } from "@/client/routes/admin/users";
import type { Permission } from "@/shared/auth";
import { parseSiteConfig, type SiteConfig } from "@/shared/config";
import type { ConfigState } from "@/shared/schemas/admin";
import type { Me } from "@/shared/schemas/auth";
import type { DisplayState } from "@/shared/view";
import demo from "../../sites/demo.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config = parseSiteConfig(demo);
const state: ConfigState = { config, version: 4, savedAt: "2026-09-27T10:00:00Z", savedBy: "admin" };

let root: Root | null = null;
let host: HTMLElement;
let calls: { method: string; path: string; body: unknown }[] = [];
let reply: (method: string, path: string) => { status: number; body: unknown } = () => ({
  status: 500,
  body: { error: "http_error", message: "no reply" },
});

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
      calls.push({ method, path: u.pathname + u.search, body: raw && JSON.parse(raw) });
      const r = reply(method, u.pathname);
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
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
const button = (label: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;

const me = (permissions: Permission[]): Me => ({
  user: {
    id: "u1",
    name: "Test Owner",
    email: ["owner", "example.com"].join("@"),
    image: null,
    role: "owner",
    createdAt: "2026-09-01T00:00:00Z",
  },
  permissions,
  providers: { emailPassword: true, github: false, google: false },
  setupNeeded: false,
});
const ALL: Permission[] = ["page.view", "config.edit", "sources.manage", "users.manage", "instance.manage"];

async function shell(path: string, permissions: Permission[], downCount: number) {
  const rootRoute = createRootRoute({
    component: () =>
      createElement(
        AdminLayout,
        { siteName: "Acme Cloud", me: me(permissions), downCount },
        createElement(Outlet),
      ),
  });
  const pages = [
    "/admin",
    "/admin/status-page",
    "/admin/alerts",
    "/admin/settings",
    "/admin/settings/users",
  ].map((p) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: p,
      component: () => createElement("p", null, `page ${p}`),
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren(pages),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  root = createRoot(host);
  await act(async () => root!.render(createElement(RouterProvider, { router })));
  await settle();
  return router;
}

const tabs = () => [...document.querySelectorAll('nav[aria-label="Admin"] a')] as HTMLAnchorElement[];

describe("admin shell", () => {
  it("shows the four tabs, the site name and a down badge on Monitors", async () => {
    await shell("/admin", ALL, 2);
    expect(tabs().map((a) => a.textContent?.replace(/\d+ down$/, "").trim())).toEqual([
      "Monitors",
      "Status page",
      "Alerts",
      "Settings",
    ]);
    expect(tabs().map((a) => a.getAttribute("href"))).toEqual(ADMIN_TABS.map((t) => t.to));
    const badges = document.querySelectorAll("[data-down-badge]");
    expect(badges).toHaveLength(1);
    expect(badges[0]!.textContent).toBe("2 down");
    expect(badges[0]!.closest("a")?.getAttribute("href")).toBe("/admin");
    expect(document.querySelector("[data-site-name]")?.textContent).toBe("Acme Cloud");
    expect(document.getElementById("account-menu")?.textContent).toContain("Test Owner");
    expect(document.querySelector("h1")).toBeNull();
  });

  it("marks the current tab (Monitors only on its own page, Settings on its sub-pages)", async () => {
    await shell("/admin/settings/users", ALL, 0);
    const current = tabs().filter((a) => a.getAttribute("aria-current") === "page");
    expect(current.map((a) => a.textContent)).toEqual(["Settings"]);
    expect(document.querySelector("[data-down-badge]")).toBeNull();
  });

  it("shows only the tabs the user's permissions open", async () => {
    await shell("/admin/settings", ["page.view", "users.manage"], 3);
    expect(tabs().map((a) => a.textContent)).toEqual(["Settings"]);
  });
});

describe("old admin URLs", () => {
  it("each redirects to its new place", () => {
    const routes = {
      "/admin/sources": SourcesRoute,
      "/admin/users": UsersRoute,
      "/admin/revisions": RevisionsRoute,
      "/admin/files": FilesRoute,
      "/admin/themes": ThemesRoute,
    } as const;
    expect(Object.keys(routes).sort()).toEqual(Object.keys(LEGACY_ADMIN_REDIRECTS).sort());
    expect(LEGACY_ADMIN_REDIRECTS).toEqual({
      "/admin/sources": "/admin/settings/sources",
      "/admin/users": "/admin/settings/users",
      "/admin/revisions": "/admin/settings/revisions",
      "/admin/files": "/admin/settings/import-export",
      "/admin/themes": "/admin/status-page",
    });
    for (const [from, route] of Object.entries(routes)) {
      let thrown: unknown;
      try {
        (route.options.beforeLoad as () => void)();
      } catch (err) {
        thrown = err;
      }
      expect(isRedirect(thrown), from).toBe(true);
      expect((thrown as { options: { to: string } }).options.to, from).toBe(
        LEGACY_ADMIN_REDIRECTS[from as keyof typeof LEGACY_ADMIN_REDIRECTS],
      );
    }
  });
});

describe("Drawer", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return createElement(
      "div",
      null,
      createElement("button", { type: "button", id: "opener", onClick: () => setOpen(true) }, "Open it"),
      createElement(
        Drawer,
        {
          open,
          onClose: () => setOpen(false),
          title: "New monitor",
          initialFocus: "#first",
          footer: createElement("button", { type: "button", id: "last" }, "Save"),
        },
        createElement("input", { id: "first", "aria-label": "First" }),
      ),
    );
  }
  const dialog = () => document.querySelector("dialog")!;
  const key = (el: Element, k: string, shift = false) =>
    act(() => {
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true, cancelable: true }),
      );
    });

  it("opens as a modal named by its title, focuses the first field and keeps Tab inside", () => {
    mount(createElement(Harness));
    const opener = document.getElementById("opener")!;
    opener.focus();
    act(() => opener.click());
    expect(dialog().open).toBe(true);
    expect(document.getElementById(dialog().getAttribute("aria-labelledby")!)?.textContent).toBe(
      "New monitor",
    );
    expect(document.activeElement?.id).toBe("first");
    // Tab from the last control wraps to the first (the close button), Shift+Tab from the first to the last.
    document.getElementById("last")!.focus();
    key(document.getElementById("last")!, "Tab");
    expect(document.activeElement?.hasAttribute("data-drawer-close")).toBe(true);
    key(document.activeElement!, "Tab", true);
    expect(document.activeElement?.id).toBe("last");
  });

  it("closes on Escape and gives focus back to the opener", () => {
    mount(createElement(Harness));
    const opener = document.getElementById("opener")!;
    opener.focus();
    act(() => opener.click());
    key(document.getElementById("first")!, "Escape");
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(document.getElementById("first")).toBeNull();
  });

  it("closes on a backdrop click and on the close button", () => {
    mount(createElement(Harness));
    const opener = document.getElementById("opener")!;
    opener.focus();
    act(() => opener.click());
    act(() => dialog().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(dialog().open).toBe(false);
    act(() => opener.click());
    act(() => button("Close").click());
    expect(dialog().open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});

describe("StatePill and Toast", () => {
  it("names every state in words", () => {
    const states = Object.keys(STATE_WORD) as DisplayState[];
    mount(createElement("div", null, ...states.map((s) => createElement(StatePill, { key: s, state: s }))));
    expect([...document.querySelectorAll("[data-state]")].map((e) => e.textContent)).toEqual(
      states.map((s) => STATE_WORD[s]),
    );
    expect(STATE_WORD.stale).toBe("No recent data");
    // Every pill has its icon (decorative) next to the word.
    expect(document.querySelectorAll('[data-state] svg[aria-hidden="true"]')).toHaveLength(states.length);
  });

  it("announces a toast in a polite live region", () => {
    function Say() {
      const toast = useToast();
      return createElement("button", { type: "button", onClick: () => toast("Paused API health") }, "Say");
    }
    mount(createElement(ToastProvider, null, createElement(Say)));
    const region = document.querySelector("[data-toast]")!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.getAttribute("role")).toBe("status");
    act(() => button("Say").click());
    expect(region.textContent).toBe("Paused API health");
  });
});

describe("the save path", () => {
  const renamed = (c: SiteConfig): SiteConfig => ({ ...c, name: "Acme Renamed" });

  it("applies the change to the loaded config and saves it with the plain note", async () => {
    reply = () => ({ status: 200, body: { version: 5, diff: [] } });
    const out = await saveChange("demo", state, renamed, "Renamed the site");
    expect(out).toMatchObject({ ok: true, version: 5 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("PUT");
    expect(calls[0]!.path).toBe("/api/admin/sites/demo/config");
    // Exactly what the full editor sends: the whole config as loaded, with the change, and the base version.
    expect(calls[0]!.body).toEqual(
      JSON.parse(
        JSON.stringify({
          config: { ...config, name: "Acme Renamed" },
          baseVersion: 4,
          note: "Renamed the site",
        }),
      ),
    );
  });

  it("never sends an invalid change", async () => {
    const out = await saveChange("demo", state, (c) => ({ ...c, name: "" }), "Cleared the name");
    expect(out.ok).toBe(false);
    expect(out.ok ? null : out.reason).toBe("invalid");
    expect(out.ok ? [] : out.issues.map((i) => i.path)).toContain("name");
    expect(calls).toHaveLength(0);
  });

  it("on a conflict reloads and says so in plain words", async () => {
    reply = () => ({
      status: 409,
      body: { error: "conflict", message: "Config changed", issues: [], currentVersion: 6 },
    });
    const onReload = vi.fn();
    let api: ReturnType<typeof useSiteConfig> | null = null;
    function Probe() {
      api = useSiteConfig({ site: "demo", state, onReload });
      return null;
    }
    mount(createElement(Probe));
    let out: SaveOutcome | null = null;
    await act(async () => {
      out = await api!.save(renamed, "Renamed the site");
    });
    expect(out).toMatchObject({ ok: false, reason: "conflict", message: CONFLICT_MESSAGE });
    expect(CONFLICT_MESSAGE).not.toMatch(/version|revision|409/i);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("keeps the saved config and version, so a second save builds on the first", async () => {
    let v = 4;
    reply = () => ({ status: 200, body: { version: ++v, diff: [] } });
    const onReload = vi.fn();
    let api: ReturnType<typeof useSiteConfig> | null = null;
    function Probe() {
      api = useSiteConfig({ site: "demo", state, onReload });
      return null;
    }
    mount(createElement(Probe));
    await act(async () => {
      await api!.save(renamed, "Renamed the site");
      await api!.save((c) => ({ ...c, theme: "b-control-room" }), "Changed the theme");
    });
    expect(calls.map((c) => (c.body as { baseVersion: number }).baseVersion)).toEqual([4, 5]);
    const second = (calls[1]!.body as { config: SiteConfig }).config;
    expect(second.name).toBe("Acme Renamed");
    expect(second.theme).toBe("b-control-room");
    expect(api!.version).toBe(6);
    expect(onReload).toHaveBeenCalledTimes(2);
  });
});
