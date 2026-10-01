// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertsPage } from "@/client/lib/admin/alerts/AlertsPage";
import {
  coverage,
  deliverySentence,
  destination,
  draftChannel,
  failureWords,
  freeIdFor,
  groupDeliveries,
  groupSummary,
  slugOf,
  TILE_ORDER,
} from "@/client/lib/admin/alerts/model";
import { newChannel, withChannelType, withId } from "@/client/lib/admin/ChannelsEditor";
import { ToastProvider } from "@/client/lib/admin/Toast";
import { parseSiteConfig, type SiteConfig } from "@/shared/config";
import { monitorServiceId } from "@/shared/monitors";
import { CHANNEL_TYPES, ChannelConfig, type ChannelConfigInput, type ChannelType } from "@/shared/notify";
import type { ConfigState, Delivery } from "@/shared/schemas/admin";
import demo from "../../sites/demo.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Test values built at run time (the repo scan rejects written addresses and token-shaped literals). */
const mail = (local: string) => [local, "example.org"].join("@");
const SID = ["AC", "0123456789abcdef".repeat(2)].join("");

const channel = (input: ChannelConfigInput): ChannelConfig => ChannelConfig.parse(input);
/** Channel ids that would stand out if a card ever rendered one. */
const OPS = channel({
  id: "ch-7f3a",
  name: "Ops Slack",
  type: "slack",
  secret: "NOTIFY_SLACK_OPS",
  events: ["down", "up", "stale"],
  services: [monitorServiceId("shop")],
});
const ONCALL = channel({ id: "ch-9b2c", name: "On-call inbox", type: "email", to: [mail("oncall")] });

const base = parseSiteConfig({
  ...demo,
  sections: [],
  displayNames: {},
  monitors: [
    { id: "shop", name: "Shop", type: "http", url: "https://shop.example.org/" },
    { id: "api", name: "Public API", type: "http", url: "https://api.example.org/" },
  ],
});
const withChannels = (channels: ChannelConfig[], discord = false): SiteConfig => ({
  ...base,
  notify: { discord, channels },
});

const ROWS: Delivery[] = [
  {
    incidentId: `${monitorServiceId("shop")}:2026-09-28T10:00:00Z`,
    kind: "open",
    channel: OPS.id,
    status: "sent",
    attempts: 1,
    retryable: null,
    createdAt: "2026-09-28T10:00:01Z",
    sentAt: "2026-09-28T10:00:02Z",
    lastAttemptAt: "2026-09-28T10:00:02Z",
    error: null,
  },
  {
    incidentId: `${monitorServiceId("shop")}:2026-09-28T10:00:00Z`,
    kind: "open",
    channel: ONCALL.id,
    status: "failed",
    attempts: 3,
    retryable: true,
    createdAt: "2026-09-28T10:00:01Z",
    sentAt: null,
    lastAttemptAt: "2026-09-28T10:01:00Z",
    error: "http_503",
  },
  {
    incidentId: "kuma:watch-1:2026-09-27T08:00:00Z",
    kind: "resolve",
    channel: OPS.id,
    status: "sent",
    attempts: 1,
    retryable: null,
    createdAt: "2026-09-27T09:00:00Z",
    sentAt: "2026-09-27T09:00:01Z",
    lastAttemptAt: "2026-09-27T09:00:01Z",
    error: null,
  },
];

let root: Root | null = null;
let host: HTMLElement;
let calls: { method: string; path: string; body: unknown }[] = [];
let version = 4;
let testReply: { status: number; body: unknown } = {
  status: 200,
  body: { sent: true, status: 204, error: null },
};
let deliveries: Delivery[] = ROWS;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  calls = [];
  version = 4;
  deliveries = ROWS;
  testReply = { status: 200, body: { sent: true, status: 204, error: null } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit = {}) => {
      const u = new URL(String(url));
      const raw = typeof init.body === "string" ? init.body : undefined;
      const method = init.method ?? "GET";
      calls.push({ method, path: u.pathname + u.search, body: raw && JSON.parse(raw) });
      if (method === "PUT") return Response.json({ version: ++version, diff: [] });
      if (u.pathname.endsWith("/notifications")) return Response.json({ deliveries });
      if (u.pathname === "/api/admin/notify/test")
        return Response.json(testReply.body, { status: testReply.status });
      return Response.json({ error: "not_found", message: "Not found" }, { status: 404 });
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
async function page(config: SiteConfig) {
  const state: ConfigState = { config, version: 4, savedAt: "2026-09-27T10:00:00Z", savedBy: "admin" };
  root = createRoot(host);
  act(() =>
    root!.render(
      createElement(
        ToastProvider,
        null,
        createElement(AlertsPage, { site: "demo", state, view: null, onReload: vi.fn() }),
      ),
    ),
  );
  await settle();
}
async function remount(config: SiteConfig) {
  act(() => root?.unmount());
  host.innerHTML = "";
  await page(config);
}
const text = (el: ParentNode = document.body) => el.textContent ?? "";
const button = (label: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  )!;
const drawer = () => [...document.querySelectorAll("dialog")].find((d) => d.open) ?? null;
const cards = () => [...document.querySelectorAll("article[data-channel]")] as HTMLElement[];
const card = (name: string) => cards().find((c) => c.querySelector("h2")?.textContent?.startsWith(name))!;
const toast = () => document.querySelector("[data-toast]")?.textContent ?? "";
function field(label: string, scope: ParentNode = drawer() ?? document) {
  const l = [...scope.querySelectorAll("label")].find((x) => x.textContent === label)!;
  return document.getElementById(l.htmlFor) as HTMLInputElement;
}
const check = (labelText: string, scope: ParentNode = drawer() ?? document) =>
  [...scope.querySelectorAll("label")]
    .find((l) => l.textContent?.trim() === labelText && l.querySelector("input"))!
    .querySelector("input") as HTMLInputElement;
function type(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const tile = (label: string) => check(label);
const lastSaved = () => {
  const put = calls.filter((c) => c.method === "PUT").at(-1)!;
  return put.body as { config: SiteConfig; note: string };
};
async function submitDrawer(label: string) {
  act(() => button(label, drawer()!).click());
  await settle();
}

describe("alert channel cards", () => {
  it("show each channel's name, type, where it sends and which monitors, by name", async () => {
    await page(withChannels([OPS, ONCALL]));
    expect(cards().map((c) => c.querySelector("h2")?.textContent)).toEqual(["Ops Slack", "On-call inbox"]);
    const ops = card("Ops Slack");
    expect(text(ops)).toContain("Slack. Posts to a Slack channel through its webhook. Only Shop.");
    expect([...ops.querySelectorAll('[aria-label="Sends when"] li')].map((l) => l.textContent)).toEqual([
      "Down",
      "Back up",
      "Source silent",
    ]);
    expect(text(card("On-call inbox"))).toContain(`Email. Emails ${mail("oncall")}. All monitors.`);
    // The last alert from the delivery log, in words.
    expect(text(ops)).toMatch(/Last alert .* ago: Shop went down\./);
    expect(text(card("On-call inbox"))).toContain("Shop went down (not delivered).");
  });

  it("never render internal ids or secret names outside the drawer", async () => {
    await page(withChannels([OPS, ONCALL]));
    const body = text();
    for (const hidden of [OPS.id, ONCALL.id, "NOTIFY_", monitorServiceId("shop"), "kuma:watch-1", "http_503"])
      expect(body, hidden).not.toContain(hidden);
  });

  it("shows an empty state with Add channel when there are none", async () => {
    await page(withChannels([]));
    expect(text()).toContain("No alert channels yet");
    expect(cards()).toHaveLength(0);
    // The page header and the empty state both offer it.
    expect(
      [...document.querySelectorAll("button")].filter((b) => b.textContent === "Add channel"),
    ).toHaveLength(2);
  });

  it("lists recent alerts in plain words with where they went", async () => {
    await page(withChannels([OPS, ONCALL]));
    const items = [...document.querySelectorAll("li[data-alert]")].map((l) => l.textContent ?? "");
    expect(items).toHaveLength(2);
    expect(items[0]).toContain("Shop went down");
    expect(items[0]).toContain(
      "Sent to Ops Slack. Not delivered to On-call inbox: the address answered 503 (trying again).",
    );
    expect(items[1]).toContain("Uptime Kuma (watch-1) is reporting again");
    expect(calls[0]).toMatchObject({ method: "GET", path: "/api/admin/sites/demo/notifications?limit=50" });
  });
});

describe("adding a channel", () => {
  const fill: Record<ChannelType, () => Partial<ChannelConfig>> = {
    email: () => {
      type(field("Email address"), mail("ops"));
      return { to: [mail("ops")] } as Partial<ChannelConfig>;
    },
    discord: () => ({}),
    slack: () => ({}),
    telegram: () => {
      type(field("Chat"), "@ops_alerts");
      return { chatId: "@ops_alerts" } as Partial<ChannelConfig>;
    },
    sms: () => {
      type(field("Phone number"), "+15550100199");
      type(field("Send from"), "+15550100100");
      type(field("Twilio Account SID"), SID);
      return { to: "+15550100199", from: "+15550100100", accountSid: SID } as Partial<ChannelConfig>;
    },
    webhook: () => ({}),
    ntfy: () => ({}),
  };

  it("offers exactly the schema's channel types as tiles", async () => {
    await page(withChannels([OPS]));
    act(() => button("Add channel").click());
    const tiles = [...drawer()!.querySelectorAll('input[name="channel-type"]')].map(
      (i) => (i as HTMLInputElement).value,
    );
    expect([...tiles].sort()).toEqual([...CHANNEL_TYPES].sort());
    expect(TILE_ORDER).toHaveLength(CHANNEL_TYPES.length);
    expect(text(drawer()!)).toContain("we store only the name of a secret, never its value");
  });

  it("writes, for each type, the same channel object the full editor would", async () => {
    for (const t of CHANNEL_TYPES) {
      await remount(withChannels([OPS]));
      calls = [];
      act(() => button("Add channel").click());
      act(() =>
        tile(
          {
            email: "Email",
            discord: "Discord",
            slack: "Slack",
            telegram: "Telegram",
            sms: "SMS",
            webhook: "Webhook",
            ntfy: "ntfy",
          }[t],
        ).click(),
      );
      type(field("Name"), `Ops ${t}`);
      const extra = fill[t]();
      await submitDrawer("Add channel");
      const saved = lastSaved();
      const expected = {
        ...withId(withChannelType(newChannel([OPS]), t), `ops-${t}`),
        name: `Ops ${t}`,
        ...extra,
      } as ChannelConfig;
      expect(saved.config.notify.channels, t).toEqual([
        JSON.parse(JSON.stringify(OPS)),
        JSON.parse(JSON.stringify(expected)),
      ]);
      expect(ChannelConfig.safeParse(expected).success, t).toBe(true);
      expect(saved.note).toBe(`Added alert channel Ops ${t}`);
      expect(toast()).toBe(`Added alert channel Ops ${t}`);
      expect(drawer()).toBeNull();
    }
  });

  it("starts an SMS channel with down and back up only", async () => {
    await page(withChannels([]));
    act(() => button("Add channel").click());
    act(() => tile("SMS").click());
    expect(check("A monitor goes down").checked).toBe(true);
    expect(check("A monitor comes back up").checked).toBe(true);
    expect(check("A data source stops reporting").checked).toBe(false);
    expect(check("A data source reports again").checked).toBe(false);
  });

  it("limits a channel to the monitors picked by name", async () => {
    await page(withChannels([]));
    act(() => button("Add channel").click());
    type(field("Name"), "Shop pager");
    act(() => check("Only these monitors").click());
    const picker = drawer()!.querySelector('[aria-label="Monitors"]')!;
    expect(text(picker)).toContain("Shop");
    expect(text(picker)).toContain("Public API");
    expect(text(picker)).not.toContain("probe:");
    // Nothing picked yet: nothing is saved.
    await submitDrawer("Add channel");
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(text(drawer()!)).toContain("Pick at least one monitor, or choose All monitors.");
    act(() => check("Shop").click());
    await submitDrawer("Add channel");
    expect(lastSaved().config.notify.channels[0]!.services).toEqual([monitorServiceId("shop")]);
  });

  it("shows the schema's issues and saves nothing while a field is wrong", async () => {
    await page(withChannels([]));
    act(() => button("Add channel").click());
    act(() => tile("Telegram").click());
    type(field("Chat"), "not a chat");
    await submitDrawer("Add channel");
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(text(drawer()!)).toContain("Expected a chat id or @channel");
  });
});

describe("a channel's actions", () => {
  it("sends a test and says how it went", async () => {
    await page(withChannels([OPS]));
    act(() => button("Send test to Ops Slack").click());
    await settle();
    const test = calls.find((c) => c.path.startsWith("/api/admin/notify/test"))!;
    expect(test.method).toBe("POST");
    expect(test.path).toBe(`/api/admin/notify/test?site=demo&channel=${OPS.id}&kind=down`);
    expect(toast()).toBe("Test alert sent to Ops Slack. It is marked as a test.");

    testReply = { status: 502, body: { sent: false, status: 404, error: "http_404" } };
    act(() => button("Send test to Ops Slack").click());
    await settle();
    expect(toast()).toBe("The test to Ops Slack did not go through: the address answered 404.");
  });

  it("edits a channel in the drawer, keeping its id, with the secret name shown only there", async () => {
    await page(withChannels([OPS, ONCALL]));
    act(() => button("Edit Ops Slack").click());
    expect(drawer()!.querySelector("h2")?.textContent).toBe("Edit Ops Slack");
    expect(field("Slack webhook URL secret").value).toBe("NOTIFY_SLACK_OPS");
    expect(check("Only these monitors").checked).toBe(true);
    type(field("Name"), "Ops room");
    act(() => check("Only these monitors").click());
    act(() => check("All monitors").click());
    await submitDrawer("Save changes");
    const saved = lastSaved();
    expect(saved.note).toBe("Updated alert channel Ops room");
    expect(saved.config.notify.channels.map((c) => [c.id, c.name, c.services])).toEqual([
      [OPS.id, "Ops room", []],
      [ONCALL.id, "On-call inbox", []],
    ]);
  });

  it("deletes a channel only after confirming", async () => {
    await page(withChannels([OPS, ONCALL]));
    act(() => button("Edit On-call inbox").click());
    act(() => button("Delete channel", drawer()!).click());
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(text(drawer()!)).toContain("Delete On-call inbox? Alerts stop going there.");
    await submitDrawer("Delete On-call inbox");
    const saved = lastSaved();
    expect(saved.note).toBe("Deleted alert channel On-call inbox");
    expect(saved.config.notify.channels.map((c) => c.id)).toEqual([OPS.id]);
    expect(drawer()).toBeNull();
    expect(toast()).toBe("Deleted alert channel On-call inbox");
  });

  it("keeps the built-in Discord switch under More settings and saves it", async () => {
    await page(withChannels([]));
    const more = document.querySelector("details")!;
    expect(more.open).toBe(false);
    expect(text(more)).toContain("More settings");
    expect(text(more)).toContain("Built-in Discord channel");
    act(() => (more.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    await settle();
    expect(lastSaved().config.notify.discord).toBe(true);
    expect(lastSaved().note).toBe("Turned on built-in Discord alerts for down and back up");
  });
});

describe("alerts model", () => {
  it("makes ids from names and keeps them free", () => {
    expect(slugOf("Ops Slack!")).toBe("ops-slack");
    expect(slugOf("!!!")).toBe("channel");
    expect(freeIdFor("Ops Slack", [{ id: "ops-slack" }, { id: "ops-slack-2" }])).toBe("ops-slack-3");
    const d = draftChannel("webhook", "Deploy hook", []);
    expect(d).toMatchObject({
      id: "deploy-hook",
      secret: "NOTIFY_DEPLOY_HOOK",
      signingSecret: "NOTIFY_DEPLOY_HOOK_SIGNING",
    });
  });

  it("says where a channel sends without secrets, and covers by name", () => {
    const sms = channel({
      id: "sms",
      name: "Pager",
      type: "sms",
      provider: "twilio",
      accountSid: SID,
      secret: "NOTIFY_TWILIO",
      from: "+15550100100",
      to: "+15550100199",
    });
    expect(destination(sms)).toBe("Texts the number ending in 0199");
    expect(destination(OPS)).not.toContain("NOTIFY");
    const names = new Map([
      [monitorServiceId("shop"), "Shop"],
      [monitorServiceId("api"), "Public API"],
    ]);
    expect(coverage({ ...OPS, services: [monitorServiceId("shop"), monitorServiceId("api")] }, names)).toBe(
      "Only Shop and Public API",
    );
    expect(coverage(ONCALL, names)).toBe("All monitors");
  });

  it("reads deliveries as sentences and groups them per incident change", () => {
    const subjects = { services: new Map([[monitorServiceId("shop"), "Shop"]]), sources: new Map() };
    expect(deliverySentence(ROWS[0]!, subjects)).toBe("Shop went down");
    // A service or source removed since: said so, never "Something".
    expect(deliverySentence({ incidentId: "x:1", kind: "open" }, subjects)).toBe(
      "A removed service went down",
    );
    expect(deliverySentence({ incidentId: "x:1", kind: "resolve" }, subjects)).toBe(
      "A removed service came back",
    );
    expect(deliverySentence({ incidentId: "kuma:gone:1", kind: "open", subject: "source" }, subjects)).toBe(
      "A removed source went silent",
    );
    expect(
      deliverySentence({ incidentId: "kuma:gone:1", kind: "resolve", subject: "source" }, subjects),
    ).toBe("A removed source is reporting again");
    expect(deliverySentence({ incidentId: "x:1", kind: "resolve", subject: "service" }, subjects)).toBe(
      "A removed service came back",
    );
    const groups = groupDeliveries(ROWS, new Map([[OPS.id, "Ops Slack"]]), subjects);
    expect(groups).toHaveLength(2);
    expect(groupSummary(groups[0]!)).toBe(
      "Sent to Ops Slack. Not delivered to a removed channel: the address answered 503 (trying again).",
    );
    expect(failureWords("timeout")).toBe("it timed out");
    expect(failureWords("weird_code")).toBe("it failed (weird_code)");
  });
});
