// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigEditor } from "@/client/lib/admin/ConfigEditor";
import { fromLocalInput, newMonitor, toLocalInput, withType } from "@/client/lib/admin/MonitorsEditor";
import { parseSiteConfig, type SiteConfig } from "@/shared/config";
import { MonitorConfig } from "@/shared/monitors";
import type { ConfigState } from "@/shared/schemas/admin";
import demo from "../../sites/demo.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config = parseSiteConfig(demo);
const services = config.sections.flatMap((s) => s.services).map((id) => ({ id, name: `Service ${id}` }));

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
      calls.push({ method: init.method ?? "GET", path: u.pathname + u.search, body: raw && JSON.parse(raw) });
      return Response.json({ valid: true, issues: [], diff: [], version: null });
    }),
  );
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function editor(over: Partial<SiteConfig> = {}) {
  const state: ConfigState = {
    config: { ...config, ...over },
    version: 4,
    savedAt: "2026-09-27T10:00:00Z",
    savedBy: "admin",
  };
  root = createRoot(host);
  act(() => root!.render(createElement(ConfigEditor, { site: "demo", state, services, onReload: vi.fn() })));
}
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
const button = (label: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
const group = (name: string) => document.querySelector(`[role="group"][aria-label="${name}"]`) as HTMLElement;
function field(label: string, scope: ParentNode = document) {
  const l = [...scope.querySelectorAll("label")].find((x) => x.textContent === label)!;
  return document.getElementById(l.htmlFor) as HTMLInputElement & HTMLSelectElement;
}
/** The checkbox of a label whose text contains `text`. */
const box = (text: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll("label")]
    .find((l) => l.textContent?.includes(text) && l.querySelector("input[type=checkbox]"))!
    .querySelector("input") as HTMLInputElement;
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
const issuesOf = (el: HTMLElement) =>
  el.getAttribute("aria-describedby")
    ? (document.getElementById(el.getAttribute("aria-describedby")!)?.textContent ?? "")
    : "";
const text = (el: ParentNode = document.body) => el.textContent ?? "";

async function reviewed(): Promise<SiteConfig> {
  expect(button("Review changes").disabled).toBe(false);
  act(() => button("Review changes").click());
  await settle();
  return calls.at(-1)!.body as SiteConfig;
}

describe("monitors editor", () => {
  it("adds a monitor, shows its issues per field and reviews it once valid", async () => {
    editor();
    expect(text()).toContain("2 legacy probes");
    act(() => button("Add monitor").click());
    const m = group("Monitor monitor-1");
    const url = field("URL", m);
    expect(url.getAttribute("aria-invalid")).toBe("true");
    expect(button("Review changes").disabled).toBe(true);

    type(url, "https://www.example.org/health");
    expect(url.getAttribute("aria-invalid")).toBeNull();
    type(field("Id", m), "www");
    type(field("Name", group("Monitor www")), "Website");
    const interval = field("Interval (s)", group("Monitor www"));
    type(interval, "90");
    expect(issuesOf(interval)).toContain("Interval must be whole minutes");
    type(interval, "120");

    const sent = await reviewed();
    expect(sent.monitors).toEqual([
      expect.objectContaining({
        id: "www",
        name: "Website",
        type: "http",
        url: "https://www.example.org/health",
        intervalS: 120,
        runners: ["builtin"],
        enabled: true,
      }),
    ]);
  });

  it("switches type with its own fields and hints when builtin on Cloudflare cannot run it", () => {
    editor({
      monitors: [
        MonitorConfig.parse({ id: "db", name: "DB", type: "tcp", host: "db.example.org", port: 5432 }),
      ],
    });
    const m = () => group("Monitor db");
    expect(field("Port", m()).value).toBe("5432");
    // TCP runs on Cloudflare, with the note about hosts behind Cloudflare.
    expect(m().querySelectorAll('[role="note"]')).toHaveLength(1);
    expect(text(m())).toContain("cannot open TCP connections to hosts behind Cloudflare");

    choose(field("Type", m()), "ping");
    expect(field("Host", m()).value).toBe("db.example.org");
    expect(text(m())).not.toContain("Port");
    expect(m().querySelector('[role="note"]')?.textContent).toContain(
      "On Cloudflare, builtin cannot run Ping",
    );

    choose(field("Type", m()), "tls");
    expect(field("Port", m()).value).toBe("443");
    expect(field("Degraded under (days left)", m()).value).toBe("7");
    expect(text(m())).toContain("cannot run TLS certificate checks");

    choose(field("Type", m()), "http");
    expect(field("URL", m()).value).toBe("https://db.example.org/");
    expect(m().querySelector('[role="note"]')).toBeNull();
  });

  it("picks runners from builtin and the declared agents, with a quorum", async () => {
    editor({
      monitors: [MonitorConfig.parse({ id: "nas", name: "NAS", type: "ping", host: "nas.example.org" })],
    });
    act(() => button("Add agent").click());
    const agent = group("Agent agent-1");
    type(field("Id", agent), "office-1");
    type(field("Name", group("Agent office-1")), "Office");

    const m = () => group("Monitor nas");
    act(() => box("office-1", m()).click());
    expect(field("Quorum", m()).placeholder).toBe("2 (majority)");
    type(field("Quorum", m()), "3");
    expect(issuesOf(field("Quorum", m()))).toContain("Quorum exceeds the number of runners");
    type(field("Quorum", m()), "1");
    act(() => box("builtin", m()).click());
    expect(m().querySelector('[role="note"]')).toBeNull();
    expect(text(group("Agent office-1"))).toContain("Runs 1 monitor");

    const sent = await reviewed();
    expect(sent.agents).toEqual([{ id: "office-1", name: "Office" }]);
    expect(sent.monitors[0]).toMatchObject({ runners: ["office-1"], quorum: 1 });
  });

  it("flags a runner whose agent was removed and a reserved agent id", () => {
    editor({
      agents: [{ id: "office-1", name: "Office" }],
      monitors: [
        MonitorConfig.parse({ id: "nas", name: "NAS", type: "ping", host: "nas.lan", runners: ["office-1"] }),
      ],
    });
    // A private name is fine for an agent-only monitor.
    expect(button("Review changes").disabled).toBe(false);
    act(() => button("Remove agent", group("Agent office-1")).click());
    expect(text(group("Monitor nas"))).toContain("Unknown agent office-1");
    expect(text(group("Monitor nas"))).toContain("(not declared)");

    act(() => button("Add agent").click());
    type(field("Id", group("Agent agent-1")), "cf");
    expect(issuesOf(field("Id", group("Agent cf")))).toContain("Reserved agent id");
  });

  it("requires a public host while builtin runs the monitor", () => {
    editor({
      agents: [{ id: "office-1", name: "Office" }],
      monitors: [
        MonitorConfig.parse({ id: "nas", name: "NAS", type: "ping", host: "nas.lan", runners: ["office-1"] }),
      ],
    });
    act(() => box("builtin", group("Monitor nas")).click());
    expect(issuesOf(field("Host", group("Monitor nas")))).toContain("need a public hostname");
  });

  it("pauses a monitor and removes one", async () => {
    editor({
      monitors: [
        MonitorConfig.parse({ id: "a", name: "A", type: "ping", host: "a.example.org" }),
        MonitorConfig.parse({ id: "b", name: "B", type: "ping", host: "b.example.org" }),
      ],
    });
    act(() => box("Enabled", group("Monitor a")).click());
    act(() => button("Remove monitor", group("Monitor b")).click());
    const sent = await reviewed();
    expect(sent.monitors.map((m) => [m.id, m.enabled])).toEqual([["a", false]]);
  });
});

describe("maintenance editor", () => {
  it("adds a weekly window with days, time, duration, zone and services", async () => {
    editor();
    act(() => button("Add weekly window").click());
    const w = () => group("Window window-1");
    type(field("Title", w()), "Nightly backup");
    const zone = field("Time zone", w());
    const zones = [...zone.options].map((o) => o.value);
    expect(zones[0]).toBe("UTC");
    expect(zones).toContain("Europe/Paris");
    choose(zone, "Europe/Paris");
    act(() => box("Sat", w()).click());
    type(field("Starts at", w()), "23:30");
    type(field("Duration (min)", w()), "150");
    expect(text(w())).toContain("none checked: every service");
    act(() => box("kuma:5", w()).click());
    act(() => box("probe:web-app", w()).click());
    expect(text(w())).not.toContain("none checked");

    const sent = await reviewed();
    expect(sent.maintenance).toEqual([
      {
        kind: "weekly",
        id: "window-1",
        title: "Nightly backup",
        services: ["kuma:5", "probe:web-app"],
        days: ["sat", "sun"],
        start: "23:30",
        durationMin: 150,
        timeZone: "Europe/Paris",
      },
    ]);
  });

  it("shows per-field issues of a weekly window", () => {
    editor();
    act(() => button("Add weekly window").click());
    const w = () => group("Window window-1");
    act(() => box("Sun", w()).click());
    expect(text(w())).toContain("Too small");
    type(field("Duration (min)", w()), "2000");
    expect(field("Duration (min)", w()).getAttribute("aria-invalid")).toBe("true");
    expect(button("Review changes").disabled).toBe(true);
  });

  it("edits a one-off window in UTC and checks the end is after the start", async () => {
    editor();
    act(() => button("Add one-off window").click());
    const w = () => group("Window window-1");
    type(field("Start (UTC)", w()), "2026-10-03T08:00");
    type(field("End (UTC)", w()), "2026-10-03T07:00");
    expect(issuesOf(field("End (UTC)", w()))).toContain("end must be after start");
    type(field("End (UTC)", w()), "2026-10-03T10:30");
    const sent = await reviewed();
    expect(sent.maintenance[0]).toMatchObject({
      kind: "once",
      start: "2026-10-03T08:00:00Z",
      end: "2026-10-03T10:30:00Z",
      services: [],
    });
  });

  it("offers a new monitor's service to a window before it is saved", () => {
    editor();
    act(() => button("Add monitor").click());
    act(() => button("Add one-off window").click());
    expect(text(group("Window window-1"))).toContain("probe:monitor-1");
  });

  it("removes a window", async () => {
    editor({
      maintenance: [
        {
          kind: "once",
          id: "old",
          title: "Old",
          services: [],
          start: "2026-09-01T00:00:00Z",
          end: "2026-09-01T01:00:00Z",
        },
      ],
    });
    act(() => button("Remove window", group("Window old")).click());
    expect((await reviewed()).maintenance).toEqual([]);
  });
});

describe("alerts", () => {
  it("switches the down and up cards on", async () => {
    editor();
    const discord = box("Discord cards when a service goes down");
    expect(discord.checked).toBe(false);
    act(() => discord.click());
    expect((await reviewed()).notify).toEqual({ discord: true, webhooks: [] });
  });
});

describe("editor helpers", () => {
  it("keeps the common fields and the host across types", () => {
    const tcp = MonitorConfig.parse({
      id: "db",
      name: "DB",
      type: "tcp",
      host: "db.example.org",
      port: 5432,
      retries: 3,
      enabled: false,
    });
    expect(withType(tcp, "tls")).toMatchObject({
      type: "tls",
      host: "db.example.org",
      port: 5432,
      retries: 3,
      enabled: false,
    });
    expect(MonitorConfig.safeParse(withType(tcp, "http")).success).toBe(true);
    expect(MonitorConfig.safeParse(withType(tcp, "ping")).success).toBe(true);
    expect(withType(tcp, "tcp")).toBe(tcp);
  });

  it("gives a new monitor a free id", () => {
    const first = newMonitor([]);
    expect(first.id).toBe("monitor-1");
    expect(newMonitor([first, { ...first, id: "monitor-2" }]).id).toBe("monitor-3");
  });

  it("converts datetime-local values to UTC timestamps and back", () => {
    expect(toLocalInput("2026-09-28T10:05:00Z")).toBe("2026-09-28T10:05");
    expect(fromLocalInput("2026-09-28T10:05")).toBe("2026-09-28T10:05:00Z");
    expect(fromLocalInput("")).toBe("");
  });
});
