// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newMonitor, withType } from "@/client/lib/admin/MonitorsEditor";
import { MonitorsDashboard } from "@/client/lib/admin/monitors/Dashboard";
import { buildRows, inferType, nameFromTarget, sortRows, statsOf } from "@/client/lib/admin/monitors/model";
import { ToastProvider } from "@/client/lib/admin/Toast";
import { parseSiteConfig, type SiteConfig } from "@/shared/config";
import { type MonitorConfig, probeAsMonitor } from "@/shared/monitors";
import type { ConfigState } from "@/shared/schemas/admin";
import { buildSiteView, type ServiceView, type SiteView } from "@/shared/view";
import demo from "../../sites/demo.json";
import { fixtureInput } from "../fixtures/view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The demo site with a heartbeat and a paused monitor added; its view is the `incident` fixture (Kuma
 * services, Replica Postgres down) plus a facts, a webhook and a legacy probe service.
 */
const config = parseSiteConfig({
  ...demo,
  monitors: [
    { id: "nightly", name: "Nightly backup", type: "push", intervalS: 86_400, graceS: 3600 },
    { id: "shop", name: "Shop", type: "http", url: "https://shop.example.org/", enabled: false },
  ],
});
const incident = buildSiteView(fixtureInput("incident"));
const like = (id: string, name: string, over: Partial<ServiceView> = {}): ServiceView => ({
  ...incident.sections[0]!.services[0]!,
  id,
  name,
  ...over,
});
const view: SiteView = {
  ...incident,
  unsectioned: [
    ...incident.unsectioned,
    like("facts:backup-age", "Backup age", { kind: "fact", targetDisplay: null }),
    like("webhook:deploys", "Deploy pipeline", { targetDisplay: null }),
    like("probe:api-health", "API health (edge)"),
    like("probe:nightly", "Nightly backup", {
      kind: "push",
      recent: [
        { ts: "2026-09-27T20:00:00Z", status: "up", latencyMs: null, message: "OK", important: false },
      ],
    }),
  ],
};
const state: ConfigState = { config, version: 4, savedAt: "2026-09-27T10:00:00Z", savedBy: "admin" };

/** A secret-shaped push token built at run time (the repo scan rejects token literals). */
const TOKEN = Array.from({ length: 32 }, (_, i) => "abcdefghjkmnpqrstuvwxyz23456789"[i % 31]).join("");
const PUSH_URL = `https://status.example.com/api/push/${TOKEN}`;

let root: Root | null = null;
let host: HTMLElement;
let calls: { method: string; path: string; body: unknown }[] = [];
let version = 4;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  calls = [];
  version = 4;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit = {}) => {
      const u = new URL(String(url));
      const raw = typeof init.body === "string" ? init.body : undefined;
      const method = init.method ?? "GET";
      calls.push({ method, path: u.pathname + u.search, body: raw && JSON.parse(raw) });
      const push = /\/monitors\/([^/]+)\/push-token$/.exec(u.pathname);
      const body =
        method === "PUT"
          ? { version: ++version, diff: [] }
          : push
            ? { monitorId: push[1], url: PUSH_URL, createdAt: "2026-09-28T00:00:00Z", rotated: false }
            : { error: "not_found", message: "Not found" };
      const status = method === "PUT" ? 200 : push ? 201 : 404;
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
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
function dashboard(c: SiteConfig = config, v: SiteView | null = view) {
  const onReload = vi.fn();
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(
        ToastProvider,
        null,
        createElement(MonitorsDashboard, { site: "demo", state: { ...state, config: c }, view: v, onReload }),
      ),
    ),
  );
  return onReload;
}
const text = () => document.body.textContent ?? "";
const buttons = (label: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll("button")].filter((b) => b.textContent?.trim() === label);
const button = (label: string, scope: ParentNode = document) => buttons(label, scope)[0]!;
const rowButtons = () =>
  [...document.querySelectorAll("tr[data-row] button[aria-expanded]")] as HTMLButtonElement[];
const rowNames = () => rowButtons().map((b) => b.querySelector("span > span")?.textContent);
const rowOf = (name: string) =>
  rowButtons().find((b) => b.querySelector("span > span")?.textContent === name)!;
const drawer = () => [...document.querySelectorAll("dialog")].find((d) => d.open)!;
function field(label: string, scope: ParentNode = document) {
  const l = [...scope.querySelectorAll("label")].find((x) => x.textContent?.trim() === label)!;
  return document.getElementById(l.htmlFor) as HTMLInputElement & HTMLSelectElement;
}
function type(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function choose(el: HTMLSelectElement, value: string) {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const submit = (formId: string) =>
  act(async () => {
    document.getElementById(formId)!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
const saved = (i = 0) =>
  calls.filter((c) => c.method === "PUT")[i]!.body as { config: SiteConfig; note: string };

describe("dashboard rows", () => {
  it("joins monitors, heartbeats and other sources, down first and paused last, with the numbers", () => {
    const rows = sortRows(buildRows(config, view));
    expect(rows[0]!.name).toBe("Replica Postgres");
    expect(rows.at(-1)!.name).toBe("Shop");
    const stats = statsOf(rows);
    expect(stats.down).toBe(1);
    expect(stats.downNames).toEqual(["Replica Postgres"]);
    expect(stats.paused).toBe(1);
    expect(stats.total).toBe(rows.length);
    // web-app has no data yet: pending, not up.
    expect(rows.find((r) => r.name === "Web app (edge)")!.state).toBe("pending");
    expect(stats.up).toBe(rows.filter((r) => r.state === "up").length);
    const kinds = Object.fromEntries(rows.map((r) => [r.name, r.kind]));
    expect(kinds).toMatchObject({
      "Nightly backup": "push",
      "Backup age": "facts",
      "Deploy pipeline": "webhook",
      "Primary Postgres": "kuma",
      "API health (edge)": "http",
    });
  });

  it("renders the numbers, one table in that order and never an internal id", () => {
    dashboard();
    const t = text();
    expect(document.querySelector("h1")?.textContent).toBe("Monitors");
    const overview = document.querySelector('[aria-label="Overview"]')!.textContent;
    expect(overview).toContain("Down1Replica Postgres");
    expect(overview).toContain("Paused1Not being checked");
    expect(overview).toContain("Uptime, last 30 days");
    const names = rowNames();
    expect(names[0]).toBe("Replica Postgres");
    expect(names.at(-1)).toBe("Shop");
    expect(names).toEqual(
      expect.arrayContaining(["Nightly backup", "Backup age", "Deploy pipeline", "API health (edge)"]),
    );
    for (const label of ["Uptime Kuma", "Facts collector", "Webhook", "Heartbeat", "HTTP"])
      expect(t, label).toContain(label);
    for (const id of [
      "kuma:",
      "facts:",
      "probe:",
      "webhook:",
      "api-health",
      "web-app",
      "nightly",
      "monitor-",
    ])
      expect(t, id).not.toContain(id);
    expect(document.querySelectorAll("table")).toHaveLength(1);
  });

  it("filters to heartbeats and searches by name", () => {
    dashboard();
    const toggle = [
      ...document.querySelectorAll('[role="group"][aria-label="Show"] button'),
    ] as HTMLButtonElement[];
    act(() => toggle[1]!.click());
    expect(toggle[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(rowNames()).toEqual(["Nightly backup"]);
    expect(document.querySelector("h1")?.textContent).toBe("Heartbeats");
    act(() => toggle[0]!.click());
    type(document.querySelector('input[type="search"]') as HTMLInputElement, "postgres");
    expect(rowNames()).toEqual(["Replica Postgres", "Primary Postgres"]);
  });

  it("expands a row inline with its facts and actions", () => {
    dashboard();
    const b = rowOf("Nightly backup");
    const detail = document.getElementById(b.getAttribute("aria-controls")!)!;
    expect(detail.hidden).toBe(true);
    act(() => b.click());
    expect(b.getAttribute("aria-expanded")).toBe("true");
    expect(detail.hidden).toBe(false);
    for (const label of ["Open details", "Edit", "Pause", "Send test alert"])
      expect(button(label, detail), label).toBeTruthy();
    expect(detail.textContent).toContain("Expected every day, grace 1 hour");
    // A service another source reports has no Edit or Pause.
    const kuma = rowOf("Primary Postgres");
    act(() => kuma.click());
    const kd = document.getElementById(kuma.getAttribute("aria-controls")!)!;
    expect(buttons("Edit", kd)).toHaveLength(0);
    expect(kd.textContent).toContain("Reported by Uptime Kuma");
  });

  it("shows the empty state with one button when nothing is watched", () => {
    dashboard(parseSiteConfig({ ...demo, probes: [], monitors: [] }), null);
    expect(text()).toContain("Nothing is being watched yet");
    expect(buttons("New monitor").length).toBeGreaterThan(0);
  });
});

describe("new monitor", () => {
  it("infers the type from what is typed and names it after the host", () => {
    expect(inferType("https://shop.example.org/")).toBe("http");
    expect(inferType("http://example.com")).toBe("http");
    expect(inferType("db.example.com:5432")).toBe("tcp");
    expect(inferType("example.com")).toBe("ping");
    expect(inferType(["192", "0", "2", "10"].join("."))).toBe("ping");
    expect(inferType("example.com/health")).toBe("http");
    expect(inferType("")).toBe("http");
    expect(nameFromTarget("https://shop.example.org/cart")).toBe("shop.example.org");
    expect(nameFromTarget("db.example.com:5432")).toBe("db.example.com");
  });

  it("focuses the address, follows it with the type switch and the name until they are changed", () => {
    dashboard();
    act(() => button("New monitor").click());
    const target = document.activeElement as HTMLInputElement;
    expect(target.hasAttribute("data-monitor-target")).toBe(true);
    const checked = () => (drawer().querySelector('input[type="radio"]:checked') as HTMLInputElement).value;
    type(target, "db.example.com:5432");
    expect(checked()).toBe("tcp");
    expect(field("Name").value).toBe("db.example.com");
    type(target, "example.com");
    expect(checked()).toBe("ping");
    type(field("Name"), "My host");
    act(() => (drawer().querySelector('input[value="tls"]') as HTMLInputElement).click());
    type(target, "https://example.com/");
    expect(checked()).toBe("tls");
    expect(field("Name").value).toBe("My host");
    expect(drawer().textContent).toContain("All alert channels");
    expect(drawer().textContent).toMatch(
      /More options.*gives up after 10 s, retry once, runs on the Cloudflare edge or this server/,
    );
  });

  it("saves the same monitor the full editor adds, with a plain note, then shows it pending", async () => {
    dashboard();
    act(() => button("New monitor").click());
    type(document.activeElement as HTMLInputElement, "https://shop2.example.org/");
    await submit("monitor-form");
    await settle();
    const { config: out, note } = saved();
    const expected = {
      ...newMonitor(config.monitors),
      name: "shop2.example.org",
      url: "https://shop2.example.org/",
    } as MonitorConfig;
    expect(out.monitors.at(-1)).toEqual(expected);
    expect(out.monitors.slice(0, -1)).toEqual(JSON.parse(JSON.stringify(config.monitors)));
    expect(note).toBe("Added monitor shop2.example.org");
    // The detail drawer opens on it, pending.
    expect(drawer().querySelector("h2")?.textContent).toBe("shop2.example.org");
    expect(drawer().textContent).toContain("Pending, waiting for the first check");
    expect(document.querySelector("[data-toast]")?.textContent).toBe("Added monitor shop2.example.org");
  });

  it("maps every choice to the monitor fields", async () => {
    dashboard({ ...config, agents: [{ id: "office", name: "Head office" }] });
    act(() => button("New monitor").click());
    type(document.activeElement as HTMLInputElement, "db.internal:5432");
    choose(field("Check"), "300");
    choose(field("Give up after"), "5");
    choose(field("Before alerting"), "0");
    const office = [...drawer().querySelectorAll("label")].find((l) =>
      l.textContent?.startsWith("Agent Head office"),
    )!;
    const builtin = [...drawer().querySelectorAll("label")].find((l) =>
      l.textContent?.startsWith("Cloudflare edge"),
    )!;
    act(() => (office.querySelector("input") as HTMLInputElement).click());
    act(() => (builtin.querySelector("input") as HTMLInputElement).click());
    await submit("monitor-form");
    await settle();
    expect(saved().config.monitors.at(-1)).toEqual({
      ...withType(newMonitor(config.monitors), "tcp"),
      name: "db.internal",
      host: "db.internal",
      port: 5432,
      intervalS: 300,
      timeoutS: 5,
      retries: 0,
      runners: ["office"],
    });
  });

  it("explains a private address checked from the edge instead of saving", async () => {
    dashboard();
    act(() => button("New monitor").click());
    type(document.activeElement as HTMLInputElement, "db.internal:5432");
    await submit("monitor-form");
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(drawer().textContent).toContain("only works inside a private network");
  });
});

describe("new heartbeat", () => {
  it("saves the push monitor, asks for its address and shows it once with a curl line", async () => {
    dashboard();
    act(() => button("New heartbeat").click());
    type(field("Name"), "Invoice sender");
    type(field("Expect a heartbeat every"), "15");
    choose(field("Unit"), "minutes");
    type(field("with a grace period of"), "5");
    await submit("heartbeat-form");
    await settle();
    const { config: out, note } = saved();
    expect(out.monitors.at(-1)).toEqual({
      ...withType(newMonitor(config.monitors), "push"),
      name: "Invoice sender",
      intervalS: 900,
      graceS: 300,
    });
    expect(note).toBe("Added heartbeat Invoice sender");
    const id = out.monitors.at(-1)!.id;
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "PUT /api/admin/sites/demo/config",
      `POST /api/admin/sites/demo/monitors/${id}/push-token`,
    ]);
    const codes = [...drawer().querySelectorAll("code")].map((c) => c.textContent);
    expect(codes).toEqual([PUSH_URL, `curl -fsS "${PUSH_URL}?status=up&msg=OK"`]);
    expect(drawer().textContent).toContain("Shown once.");
    expect(drawer().textContent).toContain("Pending, waiting for the first heartbeat");
    // Closing drops it: it is never shown again.
    act(() => button("Done").click());
    expect(document.body.innerHTML).not.toContain(TOKEN);
    act(() => button("New heartbeat").click());
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(drawer().querySelector("form#heartbeat-form")).not.toBeNull();
  });
});

describe("pause and delete", () => {
  it("pauses a heartbeat from its row with a plain note", async () => {
    dashboard();
    act(() => rowOf("Nightly backup").click());
    const detail = document.getElementById(rowOf("Nightly backup").getAttribute("aria-controls")!)!;
    await act(async () => button("Pause", detail).click());
    await settle();
    const { config: out, note } = saved();
    expect(out.monitors.find((m) => m.id === "nightly")!.enabled).toBe(false);
    expect(out.monitors.filter((m) => m.id !== "nightly")).toEqual(
      JSON.parse(JSON.stringify(config.monitors.slice(1))),
    );
    expect(note).toBe("Paused Nightly backup");
    expect(document.querySelector("[data-toast]")?.textContent).toBe("Paused Nightly backup");
    // The row follows the saved config at once.
    expect(
      document.getElementById(rowOf("Nightly backup").getAttribute("aria-controls")!)!.textContent,
    ).toContain("Resume");
  });

  it("pauses a legacy probe by writing it as a monitor of the same id", async () => {
    dashboard();
    act(() => rowOf("API health (edge)").click());
    const detail = document.getElementById(rowOf("API health (edge)").getAttribute("aria-controls")!)!;
    await act(async () => button("Pause", detail).click());
    await settle();
    const probe = config.probes.find((p) => p.id === "api-health")!;
    expect(saved().config.monitors.at(-1)).toEqual({ ...probeAsMonitor(probe), enabled: false });
    expect(saved().config.probes).toEqual(JSON.parse(JSON.stringify(config.probes)));
  });

  it("resumes a paused monitor", async () => {
    dashboard();
    act(() => rowOf("Shop").click());
    await act(async () =>
      button("Resume", document.getElementById(rowOf("Shop").getAttribute("aria-controls")!)!).click(),
    );
    await settle();
    expect(saved().config.monitors.find((m) => m.id === "shop")!.enabled).toBe(true);
    expect(saved().note).toBe("Resumed Shop");
  });

  it("deletes from the detail drawer after an inline confirmation", async () => {
    dashboard();
    act(() => rowOf("Shop").click());
    act(() =>
      button("Open details", document.getElementById(rowOf("Shop").getAttribute("aria-controls")!)!).click(),
    );
    const d = drawer();
    expect(d.querySelector("h2")?.textContent).toBe("Shop");
    act(() => button("Delete", d).click());
    expect(button("Delete", d).getAttribute("aria-expanded")).toBe("true");
    expect(d.textContent).toContain("Delete Shop?");
    await act(async () => button("Delete for good", d).click());
    await settle();
    const { config: out, note } = saved();
    expect(out.monitors.map((m) => m.id)).toEqual(["nightly"]);
    expect(out.probes).toEqual(JSON.parse(JSON.stringify(config.probes)));
    expect(note).toBe("Deleted monitor Shop");
    expect(document.querySelector("dialog[open]")).toBeNull();
  });
});
