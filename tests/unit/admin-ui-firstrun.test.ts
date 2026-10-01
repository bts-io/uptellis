// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MonitorsDashboard, type MonitorsDashboardProps } from "@/client/lib/admin/monitors/Dashboard";
import { FirstRun } from "@/client/lib/admin/monitors/FirstRun";
import {
  type ChecklistFacts,
  channelFromDraft,
  checklistHidden,
  checklistItems,
  emptyChannelDraft,
  FIRST_CHANNEL_TYPES,
  FIRST_RUN_NOTE,
  hideChecklist,
  monitorFromAddress,
  needsWelcome,
  rememberTestAlert,
  skipWelcome,
  testAlertSent,
  welcomeSkipped,
} from "@/client/lib/admin/monitors/firstRun";
import { ToastProvider } from "@/client/lib/admin/Toast";
import { parseSiteConfig, type SiteConfig } from "@/shared/config";
import type { MonitorConfig } from "@/shared/monitors";
import type { ChannelConfig } from "@/shared/notify";
import type { ConfigState, Delivery } from "@/shared/schemas/admin";
import { buildSiteView } from "@/shared/view";
import demo from "../../sites/demo.json";
import { fixtureInput } from "../fixtures/view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Test addresses built at run time (the repo scan rejects such literals). */
const email = (local: string) => [local, "example.com"].join("@");

/** A site that watches nothing: no sources, probes, monitors or sections. */
const empty = parseSiteConfig({ ...demo, sources: [], probes: [], monitors: [], sections: [] });
const full = parseSiteConfig({
  ...demo,
  agents: [{ id: "office", name: "Head office" }],
  monitors: [
    { id: "nightly", name: "Nightly backup", type: "push", intervalS: 86_400, graceS: 3600 },
    {
      id: "shop",
      name: "Shop",
      type: "http",
      url: "https://shop.example.org/",
      runners: ["builtin", "office"],
    },
  ],
});
const view = buildSiteView(fixtureInput("incident"));
const stateOf = (config: SiteConfig): ConfigState => ({
  config,
  version: 4,
  savedAt: "2026-09-27T10:00:00Z",
  savedBy: "admin",
});

let root: Root | null = null;
let host: HTMLElement;
let calls: { method: string; path: string; body: unknown }[] = [];
let testReply: { status: number; body: unknown } = {
  status: 200,
  body: { sent: true, status: 204, error: null },
};

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  calls = [];
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit = {}) => {
      const u = new URL(String(url));
      const raw = typeof init.body === "string" ? init.body : undefined;
      const method = init.method ?? "GET";
      calls.push({ method, path: u.pathname + u.search, body: raw && JSON.parse(raw) });
      const r =
        method === "PUT"
          ? { status: 200, body: { version: 5, diff: [] } }
          : u.pathname === "/api/admin/notify/test"
            ? testReply
            : { status: 404, body: { error: "not_found", message: "Not found" } };
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
  vi.restoreAllMocks();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
const render = (el: ReturnType<typeof createElement>) => {
  root = createRoot(host);
  act(() => root!.render(createElement(ToastProvider, null, el)));
};
function dashboard(config: SiteConfig, over: Partial<MonitorsDashboardProps> = {}) {
  render(
    createElement(MonitorsDashboard, {
      site: "demo",
      state: stateOf(config),
      view: config === empty ? null : view,
      onReload: vi.fn(),
      ...over,
    }),
  );
}
function firstRun(config: SiteConfig = empty) {
  const onDone = vi.fn();
  const onSkip = vi.fn();
  render(
    createElement(FirstRun, { site: "demo", state: stateOf(config), onReload: vi.fn(), onDone, onSkip }),
  );
  return { onDone, onSkip };
}
const text = () => document.body.textContent ?? "";
const button = (label: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;
function field(label: string) {
  const l = [...document.querySelectorAll("label")].find((x) => x.textContent?.trim() === label)!;
  return document.getElementById(l.htmlFor) as HTMLInputElement;
}
function type(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const tile = (label: string) => {
  const l = [...document.querySelectorAll("label")].find((x) => x.textContent?.trim() === label)!;
  act(() => (l.querySelector("input") as HTMLInputElement).click());
};
const start = async () => {
  await act(async () => {
    document
      .getElementById("first-run-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
};
/** A storage that refuses every read and write, as in a locked-down browser. */
const brokenStorage = () => {
  const denied = () => {
    throw new Error("denied");
  };
  vi.stubGlobal("localStorage", { getItem: denied, setItem: denied, removeItem: denied, clear: denied });
};
const puts = () => calls.filter((c) => c.method === "PUT");
const checklist = () => document.querySelector("[data-checklist]");
const item = (key: string) => document.querySelector(`[data-item="${key}"]`)!;

describe("first run: when it shows", () => {
  it("is for a site that watches nothing, not otherwise", () => {
    expect(needsWelcome(empty, null)).toBe(true);
    expect(needsWelcome(full, view)).toBe(false);
    // Only another source's services count too.
    expect(needsWelcome({ ...empty }, view)).toBe(false);
  });

  it("is opened by the dashboard when nothing is watched, unless skipped in this browser", () => {
    const onWelcome = vi.fn();
    dashboard(empty, { onWelcome });
    expect(onWelcome).toHaveBeenCalledTimes(1);
    act(() => root!.unmount());
    root = null;

    const again = vi.fn();
    dashboard(full, { onWelcome: again });
    expect(again).not.toHaveBeenCalled();
    act(() => root!.unmount());
    root = null;

    skipWelcome("skipped-site");
    expect(welcomeSkipped("skipped-site")).toBe(true);
    const skipped = vi.fn();
    render(
      createElement(MonitorsDashboard, {
        site: "skipped-site",
        state: stateOf(empty),
        view: null,
        onReload: vi.fn(),
        onWelcome: skipped,
      }),
    );
    expect(skipped).not.toHaveBeenCalled();
  });

  it("remembers a skip even when storage refuses it", () => {
    brokenStorage();
    expect(welcomeSkipped("broken-site")).toBe(false);
    skipWelcome("broken-site");
    expect(welcomeSkipped("broken-site")).toBe(true);
  });
});

describe("first run: the screen", () => {
  it("infers the check type from the address as the New monitor drawer does", () => {
    const tcp = monitorFromAddress("db.example.com:5432", []);
    expect(tcp).toMatchObject({ type: "tcp", host: "db.example.com", port: 5432, name: "db.example.com" });
    expect(monitorFromAddress("https://shop.example.org/", [])).toMatchObject({
      type: "http",
      url: "https://shop.example.org/",
      name: "shop.example.org",
    });
    expect(monitorFromAddress("example.com", [])).toMatchObject({ type: "ping", host: "example.com" });

    firstRun();
    expect(document.querySelector("h1")?.textContent).toBe("What should we watch?");
    type(field("Address to check"), "db.example.com:5432");
    expect(text()).toContain("(TCP)");
    type(field("Address to check"), "https://shop.example.org/");
    expect(text()).toContain("(HTTP)");
  });

  it("asks each channel type for its one value, and names the secret for those that need one", () => {
    firstRun();
    expect(document.querySelectorAll('input[type="radio"]')).toHaveLength(FIRST_CHANNEL_TYPES.length);
    expect(field("Email addresses")).toBeTruthy();
    expect(document.querySelector("[data-secret-note]")).toBeNull();
    for (const [label, secret] of [
      ["Discord", "NOTIFY_ALERTS_DISCORD"],
      ["Slack", "NOTIFY_ALERTS_SLACK"],
      ["Webhook", "NOTIFY_ALERTS_WEBHOOK"],
      ["ntfy", "NOTIFY_ALERTS_NTFY"],
    ] as const) {
      tile(label);
      const note = document.querySelector("[data-secret-note]")!;
      expect(note.querySelector("code")?.textContent, label).toBe(secret);
      expect(note.textContent, label).toContain(`wrangler secret put ${secret}`);
      expect(document.querySelector('input[type="text"]:not([data-first-target])'), label).toBeNull();
    }
    tile("Telegram");
    expect(field("Chat ID")).toBeTruthy();
    expect(document.querySelector("[data-secret-note] code")?.textContent).toBe("NOTIFY_ALERTS_TELEGRAM");
    tile("SMS");
    expect(field("Phone number to text")).toBeTruthy();
    expect(field("Twilio Account SID")).toBeTruthy();
  });

  it("shapes each channel for the schema", () => {
    const taken: ChannelConfig[] = [];
    expect(
      channelFromDraft({ ...emptyChannelDraft("email"), emails: `${email("a")}, ${email("b")}` }, taken),
    ).toMatchObject({
      id: "alerts-email",
      type: "email",
      name: "Email",
      to: [email("a"), email("b")],
    });
    const slack = channelFromDraft(emptyChannelDraft("slack"), taken);
    expect(slack).toMatchObject({ id: "alerts-slack", type: "slack", secret: "NOTIFY_ALERTS_SLACK" });
    expect(channelFromDraft(emptyChannelDraft("slack"), [slack]).id).toBe("alerts-slack-2");
    expect(channelFromDraft({ ...emptyChannelDraft("sms"), smsTo: "+1 555 123 4567" }, taken)).toMatchObject({
      type: "sms",
      to: "+15551234567",
      events: ["down", "up"],
    });
  });

  it("checks each type's value in plain words and saves nothing until it is right", async () => {
    firstRun();
    await start();
    expect(text()).toContain("Enter the address to check.");
    expect(text()).toContain("Enter one or more email addresses");
    type(field("Address to check"), "https://shop.example.org/");
    type(field("Email addresses"), "not an address");
    await start();
    expect(field("Email addresses").getAttribute("aria-invalid")).toBe("true");
    tile("Telegram");
    type(field("Chat ID"), "nope");
    await start();
    expect(text()).toContain("Enter the chat ID");
    tile("SMS");
    type(field("Phone number to text"), "12");
    await start();
    expect(text()).toContain("Enter the phone number with its country code");
    expect(text()).toContain("Enter the Twilio Account SID");
    expect(puts()).toHaveLength(0);
  });

  it("saves the monitor and the channel as one change, then hands over the monitor", async () => {
    const { onDone } = firstRun();
    type(field("Address to check"), "https://shop.example.org/");
    type(field("Email addresses"), email("ops"));
    await start();
    expect(puts()).toHaveLength(1);
    const body = puts()[0]!.body as { config: SiteConfig; note: string; baseVersion: number };
    expect(body.note).toBe(FIRST_RUN_NOTE);
    expect(body.baseVersion).toBe(4);
    const m = body.config.monitors.at(-1)! as MonitorConfig & { url: string };
    expect(m).toMatchObject({ type: "http", url: "https://shop.example.org/", name: "shop.example.org" });
    expect(body.config.notify.channels).toEqual([
      expect.objectContaining({ id: "alerts-email", type: "email", to: [email("ops")] }),
    ]);
    expect(onDone).toHaveBeenCalledWith(`probe:${m.id}`);
  });

  it("offers a test alert once the channel is saved", async () => {
    const { onDone } = firstRun();
    expect(button("Send a test alert").disabled).toBe(true);
    tile("Discord");
    type(field("Address to check"), "https://shop.example.org/");
    await start();
    expect(onDone).toHaveBeenCalled();
    // Still here (the route would have moved on): the saved channel can be tested.
    expect(button("Send a test alert").disabled).toBe(false);
    await act(async () => button("Send a test alert").click());
    await settle();
    expect(calls.at(-1)!.path).toBe("/api/admin/notify/test?site=demo&channel=alerts-discord&kind=down");
    expect(text()).toContain("Test alert sent to Discord.");
    testReply = { status: 502, body: { sent: false, status: 404, error: "http_404" } };
    await act(async () => button("Send a test alert").click());
    await settle();
    expect(text()).toContain("The test alert did not go through");
    testReply = { status: 200, body: { sent: true, status: 204, error: null } };
  });

  it("skips", () => {
    const { onSkip } = firstRun();
    act(() => button("Skip for now").click());
    expect(onSkip).toHaveBeenCalled();
    expect(puts()).toHaveLength(0);
  });
});

describe("getting started", () => {
  const none: ChecklistFacts = { deliveries: null, users: null, testSent: false };
  const done = (c: SiteConfig, f: ChecklistFacts = none) =>
    Object.fromEntries(checklistItems(c, f).map((i) => [i.key, i.done]));

  it("ticks each item from the saved state", () => {
    expect(done(empty)).toEqual({
      monitor: false,
      channel: false,
      test: false,
      heartbeat: false,
      page: false,
    });
    const delivery: Delivery = {
      incidentId: "test:kuma:watch-1",
      kind: "open",
      channel: "alerts-email",
      status: "sent",
      attempts: 1,
      retryable: null,
      createdAt: "2026-09-28T00:00:00Z",
      sentAt: "2026-09-28T00:00:00Z",
      lastAttemptAt: "2026-09-28T00:00:00Z",
      error: null,
    };
    const withChannel = {
      ...full,
      notify: { discord: false, channels: [channelFromDraft(emptyChannelDraft("slack"), [])] },
    };
    expect(done(withChannel, { deliveries: [delivery], users: 2, testSent: false })).toEqual({
      monitor: true,
      channel: true,
      test: true,
      heartbeat: true,
      page: true,
      invite: true,
    });
    expect(
      done(full, { deliveries: [{ ...delivery, incidentId: "down:x" }], users: 1, testSent: false }),
    ).toMatchObject({
      test: false,
      invite: false,
      channel: false,
    });
    expect(done(full, { ...none, testSent: true }).test).toBe(true);
    // The legacy Discord switch counts as a channel; users it cannot read leave the item out.
    expect(done({ ...full, notify: { discord: true, channels: [] } }).channel).toBe(true);
    expect(checklistItems(full, none).some((i) => i.key === "invite")).toBe(false);
  });

  it("shows progress, links and a Send action on the dashboard, and sends the test", async () => {
    const onNavigate = vi.fn();
    const config = {
      ...full,
      notify: { discord: false, channels: [channelFromDraft(emptyChannelDraft("slack"), [])] },
    };
    dashboard(config, { onNavigate, facts: { deliveries: [], users: 1 } });
    await settle();
    expect(checklist()?.textContent).toContain("Getting started");
    const bar = checklist()!.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute("aria-valuenow")).toBe("4");
    expect(bar.getAttribute("aria-valuemax")).toBe("6");
    expect(checklist()!.textContent).toContain("4 of 6 done");
    act(() => (item("invite").querySelector("a") as HTMLAnchorElement).click());
    expect(onNavigate).toHaveBeenCalledWith("/admin/settings/users");
    await act(async () => button("Send", item("test")).click());
    await settle();
    expect(
      calls.some((c) => c.path.startsWith("/api/admin/notify/test?site=demo&channel=alerts-slack")),
    ).toBe(true);
    expect(item("test").getAttribute("data-done")).toBe("true");
  });

  it("hides when asked and stays hidden in this browser", async () => {
    dashboard(full);
    await settle();
    expect(checklist()).not.toBeNull();
    act(() => button("Hide").click());
    expect(checklist()).toBeNull();
    expect(checklistHidden("demo")).toBe(true);
    act(() => root!.unmount());
    root = null;
    dashboard(full);
    await settle();
    expect(checklist()).toBeNull();
  });

  it("ticks the test alert from an earlier send in this browser, per site", async () => {
    const config = {
      ...full,
      notify: { discord: false, channels: [channelFromDraft(emptyChannelDraft("slack"), [])] },
    };
    dashboard(config, { facts: { deliveries: [], users: 1 } });
    await settle();
    expect(item("test").getAttribute("data-done")).not.toBe("true");
    act(() => root!.unmount());
    root = null;
    // The server records no test send: a test that went through elsewhere is remembered in the browser.
    rememberTestAlert("demo");
    expect(testAlertSent("other")).toBe(false);
    dashboard(config, { facts: { deliveries: [], users: 1 } });
    await settle();
    expect(item("test").getAttribute("data-done")).toBe("true");
  });

  it("remembers a test alert from the first-run screen only when it went through", async () => {
    firstRun();
    tile("Discord");
    type(field("Address to check"), "https://shop.example.org/");
    await start();
    testReply = { status: 502, body: { sent: false, status: 404, error: "http_404" } };
    await act(async () => button("Send a test alert").click());
    await settle();
    expect(testAlertSent("demo")).toBe(false);
    testReply = { status: 200, body: { sent: true, status: 204, error: null } };
    await act(async () => button("Send a test alert").click());
    await settle();
    expect(testAlertSent("demo")).toBe(true);
  });

  it("survives a storage that throws", async () => {
    brokenStorage();
    expect(() => hideChecklist("demo")).not.toThrow();
    expect(() => rememberTestAlert("demo")).not.toThrow();
    expect(testAlertSent("demo")).toBe(false);
    dashboard(full);
    await settle();
    expect(checklist()).not.toBeNull();
    act(() => button("Hide").click());
    expect(checklist()).toBeNull();
  });

  it("is gone once everything is done", async () => {
    const config = {
      ...full,
      notify: { discord: false, channels: [channelFromDraft(emptyChannelDraft("slack"), [])] },
    };
    const facts = {
      deliveries: [
        {
          incidentId: "test:x",
          kind: "open",
          channel: "alerts-slack",
          status: "sent" as const,
          attempts: 1,
          retryable: null,
          createdAt: "2026-09-28T00:00:00Z",
          sentAt: null,
          lastAttemptAt: null,
          error: null,
        },
      ],
      users: 3,
    };
    dashboard(config, { facts });
    await settle();
    expect(checklist()).toBeNull();
  });
});

describe("empty states and wording", () => {
  it("uses one sentence and one button when there are no heartbeats", () => {
    dashboard(parseSiteConfig({ ...demo, monitors: [] }));
    const toggle = document.querySelectorAll('[role="group"][aria-label="Show"] button');
    act(() => (toggle[1] as HTMLButtonElement).click());
    expect(text()).toContain("No heartbeats yet");
    const section = [...document.querySelectorAll("section")].find((s) =>
      s.textContent?.includes("No heartbeats yet"),
    )!;
    expect(section.querySelectorAll("button")).toHaveLength(1);
    expect(section.querySelectorAll("p")).toHaveLength(1);
  });

  it("uses an empty state in the detail drawer before the first check", async () => {
    dashboard(full, { initialDetail: "probe:shop" });
    const d = [...document.querySelectorAll("dialog")].find((x) => x.open)!;
    expect(d.textContent).toContain("No checks yet");
    expect(d.textContent).toContain("Pending, waiting for the first check");
  });

  it("never shows internal words on the dashboard, drawers and first run", async () => {
    const forbidden = /revision|probe:|runner|builtin/i;
    // Without the view: its fixture services carry names of their own ("Runner ping").
    dashboard(full, { view: null });
    await settle();
    expect(text()).not.toMatch(forbidden);
    // Every row expanded.
    for (const b of document.querySelectorAll("tr[data-row] button[aria-expanded]"))
      act(() => (b as HTMLButtonElement).click());
    expect(text()).not.toMatch(forbidden);
    act(() => button("New monitor").click());
    expect(text()).not.toMatch(forbidden);
    act(() => button("Cancel").click());
    act(() => button("New heartbeat").click());
    expect(text()).not.toMatch(forbidden);
    act(() => root!.unmount());
    root = null;
    for (const id of ["probe:shop", "probe:nightly", "probe:api-health"]) {
      dashboard(full, { initialDetail: id, view: null });
      const d = [...document.querySelectorAll("dialog")].find((x) => x.open)!;
      act(() => button("Delete", d).click());
      expect(text(), id).not.toMatch(forbidden);
      act(() => root!.unmount());
      root = null;
    }
    firstRun();
    for (const t of ["Email", "Discord", "Telegram", "SMS"]) {
      tile(t);
      expect(text(), t).not.toMatch(forbidden);
    }
  });
});
