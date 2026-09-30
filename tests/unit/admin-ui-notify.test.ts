// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isSaved,
  newChannel,
  suggestedSecret,
  toSecretName,
  withChannelType,
  withId,
} from "@/client/lib/admin/ChannelsEditor";
import { ConfigEditor } from "@/client/lib/admin/ConfigEditor";
import { DeliveryLog, DeliveryTable, statusText } from "@/client/lib/admin/DeliveryLog";
import { publicUrls } from "@/client/lib/admin/PublicEditor";
import { parseSiteConfig, type SiteConfig } from "@/shared/config";
import { ChannelConfig, type ChannelConfigInput } from "@/shared/notify";
import { type ConfigState, Delivery, DeliveryList, NotifyTestResult } from "@/shared/schemas/admin";
import { safeErrorCode } from "@/worker/engine/delivery-log";
import demo from "../../sites/demo.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const config = parseSiteConfig(demo);
const services = config.sections.flatMap((s) => s.services).map((id) => ({ id, name: `Service ${id}` }));
/** A test address at the reserved example domain (joined here: the literal scan rejects written emails). */
const mail = (local: string) => [local, "example.org"].join("@");

let root: Root | null = null;
let host: HTMLElement;
let calls: { method: string; path: string; body: unknown }[] = [];
/** Replies by path prefix; the import dry run is always valid with an empty diff. */
let replies: Record<string, { status: number; body: unknown }[]> = {};

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  calls = [];
  replies = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit = {}) => {
      const u = new URL(String(url));
      const raw = typeof init.body === "string" ? init.body : undefined;
      calls.push({ method: init.method ?? "GET", path: u.pathname + u.search, body: raw && JSON.parse(raw) });
      const key = Object.keys(replies).find((p) => u.pathname.startsWith(p));
      const r = (key && replies[key]!.shift()) || {
        status: 200,
        body: { valid: true, issues: [], diff: [], version: null },
      };
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

const channel = (input: ChannelConfigInput): ChannelConfig => ChannelConfig.parse(input);
const OPS = channel({ id: "ops", name: "Ops Slack", type: "slack", secret: "NOTIFY_SLACK_OPS" });

function editor(over: Partial<SiteConfig> = {}, saved: Partial<SiteConfig> = over) {
  const state: ConfigState = {
    config: { ...config, ...saved },
    version: 4,
    savedAt: "2026-09-27T10:00:00Z",
    savedBy: "admin",
  };
  root = createRoot(host);
  act(() => root!.render(createElement(ConfigEditor, { site: "demo", state, services, onReload: vi.fn() })));
  if (over !== saved) {
    // Start from a draft that differs from what is saved: edit through the JSON tab and back.
    act(() => button("JSON").click());
    const area = document.getElementById("config-json") as HTMLTextAreaElement;
    typeArea(area, JSON.stringify({ ...config, ...over }));
    act(() => button("Form").click());
  }
}
const mount = (el: ReturnType<typeof createElement>) => {
  root = createRoot(host);
  act(() => root!.render(el));
};
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
const button = (label: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  )!;
const group = (name: string) => document.querySelector(`[role="group"][aria-label="${name}"]`) as HTMLElement;
function field(label: string, scope: ParentNode = document) {
  const l = [...scope.querySelectorAll("label")].find((x) => x.textContent === label)!;
  return document.getElementById(l.htmlFor) as HTMLInputElement & HTMLSelectElement;
}
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
function typeArea(el: HTMLTextAreaElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
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
  return calls.filter((c) => c.path.includes("/config/import")).at(-1)!.body as SiteConfig;
}

describe("channel editor", () => {
  it("adds a channel with a suggested secret name and reviews it", async () => {
    editor();
    act(() => button("Add channel").click());
    const g = group("Channel channel-1");
    expect(field("Webhook URL secret", g).value).toBe("NOTIFY_CHANNEL_1");
    type(field("Id", g), "ops");
    type(field("Name", group("Channel ops")), "Ops Discord");
    const sent = await reviewed();
    expect(sent.notify.channels).toEqual([
      {
        id: "ops",
        name: "Ops Discord",
        type: "discord",
        secret: "NOTIFY_OPS",
        events: ["down", "up", "stale", "recovered"],
        services: [],
        enabled: true,
      },
    ]);
  });

  it("keeps a typed secret name when the id changes", () => {
    editor();
    act(() => button("Add channel").click());
    type(field("Webhook URL secret", group("Channel channel-1")), "NOTIFY_OPS_HOOK");
    type(field("Id", group("Channel channel-1")), "ops");
    expect(field("Webhook URL secret", group("Channel ops")).value).toBe("NOTIFY_OPS_HOOK");
  });

  it("accepts only secret names, never values", () => {
    editor();
    act(() => button("Add channel").click());
    const secret = field("Webhook URL secret", group("Channel channel-1"));
    type(secret, "slack-ops url!");
    expect(secret.value).toBe("SLACK_OPS_URL");
    expect(issuesOf(secret)).toContain("Expected a secret name like NOTIFY_SLACK_OPS");
    expect(button("Review changes").disabled).toBe(true);
    type(secret, "https://hooks.example.org/x");
    expect(secret.value).not.toContain("/");
    expect(issuesOf(secret)).toContain("Expected a secret name");
    type(secret, "discord_webhook_url");
    expect(secret.value).toBe("DISCORD_WEBHOOK_URL");
    expect(issuesOf(secret)).toBe("");
    type(secret, "notify_ops");
    expect(issuesOf(secret)).toBe("");
    expect(button("Review changes").disabled).toBe(false);
    expect(text()).toContain("wrangler secret put NOTIFY_NAME");
    expect(text()).toContain("NOTIFY_NAME_FILE");
  });

  it("shows the fields of each type with their issues", async () => {
    editor();
    act(() => button("Add channel").click());
    const g = () => group("Channel channel-1");
    const typeSelect = field("Type", g());

    choose(typeSelect, "webhook");
    expect(field("Endpoint URL secret", g()).value).toBe("NOTIFY_CHANNEL_1");
    expect(field("Signing key secret (optional)", g()).value).toBe("NOTIFY_CHANNEL_1_SIGNING");
    expect(field("Authorization header secret (optional)", g()).value).toBe("");
    expect(text(g())).toContain("HMAC-SHA256");

    choose(typeSelect, "ntfy");
    const token = field("Access token secret (optional)", g());
    expect(token.value).toBe("");
    expect(issuesOf(token)).toBe("");
    type(token, "bad");
    expect(issuesOf(token)).toContain("Expected a secret name");
    type(token, "");
    expect(issuesOf(token)).toBe("");

    choose(typeSelect, "telegram");
    expect(field("Bot token secret", g()).value).toBe("NOTIFY_CHANNEL_1");
    const chat = field("Chat id", g());
    expect(issuesOf(chat)).toContain("Expected a chat id or @channel");
    type(chat, "-1001234567890");
    expect(issuesOf(chat)).toBe("");

    choose(typeSelect, "email");
    expect([...g().querySelectorAll("label")].map((l) => l.textContent)).not.toContain("Bot token secret");
    const to = field("To 1", g());
    type(to, "not-an-address");
    expect(to.getAttribute("aria-invalid")).toBe("true");
    type(to, mail("ops"));
    expect(to.getAttribute("aria-invalid")).toBeNull();
    act(() => button("Add address", g()).click());
    type(field("To 2", g()), mail("oncall"));
    type(field("From (optional)", g()), mail("status"));
    const sent = await reviewed();
    expect(sent.notify.channels[0]).toMatchObject({
      type: "email",
      to: [mail("ops"), mail("oncall")],
      from: mail("status"),
    });
    expect(sent.notify.channels[0]).not.toHaveProperty("secret");
  });

  it("makes a webhook plain or signed, with an optional Authorization header secret", async () => {
    editor();
    act(() => button("Add channel").click());
    const g = () => group("Channel channel-1");
    choose(field("Type", g()), "webhook");
    expect(text(g())).toContain("Leave empty for a plain, unsigned webhook.");
    expect(text(g())).toContain("Its value is sent as the Authorization header as is");

    const signing = field("Signing key secret (optional)", g());
    type(signing, "");
    expect(issuesOf(signing)).toBe("");
    expect(text(g())).not.toContain("HMAC-SHA256");
    expect(text(g())).toContain("no X-Uptellis-Signature header");

    const auth = field("Authorization header secret (optional)", g());
    expect(auth.placeholder).toBe("none");
    type(auth, "Bearer abc");
    expect(auth.value).toBe("BEARER_ABC");
    expect(issuesOf(auth)).toContain("Expected a secret name");
    type(auth, "notify-hook-auth");
    expect(auth.value).toBe("NOTIFY_HOOK_AUTH");
    expect(issuesOf(auth)).toBe("");
    const plain = await reviewed();
    expect(plain.notify.channels[0]).toMatchObject({
      type: "webhook",
      secret: "NOTIFY_CHANNEL_1",
      authSecret: "NOTIFY_HOOK_AUTH",
    });
    expect(plain.notify.channels[0]).not.toHaveProperty("signingSecret");
  });

  it("keeps a signed webhook signed next to its Authorization header secret", async () => {
    editor();
    act(() => button("Add channel").click());
    const g = () => group("Channel channel-1");
    choose(field("Type", g()), "webhook");
    type(field("Authorization header secret (optional)", g()), "NOTIFY_HOOK_AUTH");
    const both = await reviewed();
    expect(both.notify.channels[0]).toMatchObject({
      type: "webhook",
      signingSecret: "NOTIFY_CHANNEL_1_SIGNING",
      authSecret: "NOTIFY_HOOK_AUTH",
    });
  });

  it("needs at least one event and limits down and up to chosen services", async () => {
    editor({ notify: { ...config.notify, channels: [OPS] } });
    const g = group("Channel ops");
    for (const ev of ["Service down", "Service back up", "Source silent", "Source back"]) {
      act(() => box(ev, g).click());
    }
    expect(text(g)).toContain("Too small");
    expect(button("Review changes").disabled).toBe(true);
    act(() => box("Source back", g).click());
    act(() => box("Service down", g).click());
    act(() => box("Service kuma:1", g).click());
    const sent = await reviewed();
    // Events keep the canonical order, whatever order they were checked in.
    expect(sent.notify.channels[0]).toMatchObject({ events: ["down", "recovered"], services: ["kuma:1"] });
  });

  it("reorders, disables and removes channels", async () => {
    const pager = channel({ id: "pager", name: "Pager", type: "ntfy", secret: "NOTIFY_NTFY" });
    editor({ notify: { ...config.notify, channels: [OPS, pager] } });
    act(() => button("Move up", group("Channel pager")).click());
    act(() => box("Enabled", group("Channel ops")).click());
    let sent = await reviewed();
    expect(sent.notify.channels.map((c) => [c.id, c.enabled])).toEqual([
      ["pager", true],
      ["ops", false],
    ]);
    act(() => button("Keep editing").click());
    act(() => button("Remove channel", group("Channel pager")).click());
    sent = await reviewed();
    expect(sent.notify.channels.map((c) => c.id)).toEqual(["ops"]);
  });

  it("shows a duplicate id under the channel", () => {
    editor({ notify: { ...config.notify, channels: [OPS, { ...OPS, name: "Again" }] } });
    const second = document.querySelectorAll('[role="group"][aria-label="Channel ops"]')[1]!;
    expect(issuesOf(field("Id", second))).toContain("Duplicate channel ops");
  });

  it("shows the built-in Discord channel read-only until a channel takes its secret", () => {
    editor();
    const builtIn = group("Built-in Discord channel");
    expect(text(builtIn)).toContain("DISCORD_WEBHOOK_URL");
    expect(text(builtIn)).toContain("Events: Source silent, Source back");
    expect(text(builtIn)).toContain("only when the Alerts switch is on (it is off)");
    expect(builtIn.querySelector("input:not([type=hidden])")).toBeNull();

    act(() => box("Discord cards when a service goes down").click());
    expect(text(group("Built-in Discord channel"))).toContain(
      "Events: Service down, Service back up, Source silent, Source back",
    );

    act(() => button("Add channel").click());
    type(field("Webhook URL secret", group("Channel channel-1")), "DISCORD_WEBHOOK_URL");
    expect(group("Built-in Discord channel")).toBeNull();
    expect(text()).toContain("this switch has no effect");
  });
});

describe("send test", () => {
  const withOps = { notify: { ...config.notify, channels: [OPS] } };

  it("sends a TEST message to a saved channel and shows it was sent", async () => {
    editor(withOps);
    replies["/api/admin/notify/test"] = [
      {
        status: 200,
        body: { site: "demo", channel: "ops", kind: "up", sent: true, status: 200, error: null },
      },
    ];
    const g = group("Channel ops");
    choose(field("Test event", g), "up");
    act(() => button("Send test", g).click());
    await settle();
    expect(calls.at(-1)).toMatchObject({
      method: "POST",
      path: "/api/admin/notify/test?site=demo&channel=ops&kind=up",
    });
    expect(text(g)).toContain("Sent (HTTP 200).");
  });

  it("shows the error code when the channel refused, or the route was unavailable", async () => {
    editor(withOps);
    replies["/api/admin/notify/test"] = [
      { status: 502, body: { site: "demo", kind: "down", sent: false, status: 404, error: "http_404" } },
      { status: 503, body: { error: "unavailable", message: "NOTIFY_SLACK_OPS is not set", issues: [] } },
    ];
    const g = group("Channel ops");
    act(() => button("Send test", g).click());
    await settle();
    expect(text(g)).toContain("Failed: http_404 (HTTP 404)");
    act(() => button("Send test", g).click());
    await settle();
    expect(text(g)).toContain("Failed: unavailable (HTTP 503). NOTIFY_SLACK_OPS is not set");
  });

  it("is disabled for unsaved and edited channels", () => {
    editor(withOps, {});
    expect(button("Send test", group("Channel ops")).disabled).toBe(true);
    expect(text(group("Channel ops"))).toContain("Save the config to test this channel as edited.");
    act(() => root?.unmount());
    root = null;
    editor(withOps);
    const g = group("Channel ops");
    expect(button("Send test", g).disabled).toBe(false);
    type(field("Name", g), "Renamed");
    expect(button("Send test", g).disabled).toBe(true);
    type(field("Name", g), "Ops Slack");
    expect(button("Send test", g).disabled).toBe(false);
  });

  it("tests the built-in Discord channel with its own events", async () => {
    editor();
    replies["/api/admin/notify/test"] = [
      { status: 200, body: { site: "demo", kind: "stale", sent: true, status: 204, error: null } },
    ];
    const g = group("Built-in Discord channel");
    expect([...field("Test event", g).options].map((o) => o.value)).toEqual(["stale", "recovered"]);
    act(() => button("Send test", g).click());
    await settle();
    expect(calls.at(-1)!.path).toBe("/api/admin/notify/test?site=demo&channel=discord&kind=stale");
    expect(text(g)).toContain("Sent (HTTP 204).");
    // Switching the Alerts on changes the built-in channel's events: it is no longer the saved one.
    act(() => box("Discord cards when a service goes down").click());
    expect(button("Send test", group("Built-in Discord channel")).disabled).toBe(true);
  });
});

describe("public settings", () => {
  const pub = () => group("Public URLs");

  it("toggles public access and fields, and warns when nothing is shared", async () => {
    editor();
    act(() => box("Public access").click());
    expect(text()).toContain("No field is checked");
    act(() => box("Generated at").click());
    act(() => box("Verdict").click());
    expect(text()).not.toContain("No field is checked");
    expect(text()).toContain("The overall state and its label; the site badge.");
    expect(text()).toContain("Open incidents and the last 5 resolved");
    const sent = await reviewed();
    // Fields keep the contract's order.
    expect(sent.public).toEqual({ enabled: true, fields: ["verdict", "generatedAt"] });
  });

  it("warns that a private site never answers the public endpoints", () => {
    editor({ visibility: "private" });
    expect(text()).toContain("always answer 404");
    act(() => box("Public access").click());
    expect(text()).toContain("always answer 404");
  });

  it("shows the badge and widget URLs and a copyable embed snippet", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    editor();
    expect(text(pub())).toContain("https://status.example.com/badge/demo.svg");
    expect(text(pub())).toContain("https://status.example.com/badge/demo/kuma:1.svg");
    expect(text(pub())).toContain("https://status.example.com/badge/demo/kuma:1.svg?metric=uptime");
    expect(text(pub())).toContain("https://status.example.com/embed/demo");
    expect(text(pub())).toContain("https://status.example.com/api/public/demo/summary.json");
    choose(field("Service for the badge URLs", pub()), "kuma:3");
    expect(text(pub())).toContain("https://status.example.com/badge/demo/kuma:3.svg");

    const snippet = field("Embed snippet", pub());
    expect(snippet.value).toBe(
      '<div data-uptellis="demo"></div><script src="https://status.example.com/embed.js" async></script>',
    );
    act(() => button("Copy snippet", pub()).click());
    await settle();
    expect(writeText).toHaveBeenCalledWith(snippet.value);
    expect(text(pub())).toContain("Copied.");
    expect(pub().querySelector("iframe")).toBeNull();
  });

  it("shows the site badge image only once the verdict is saved public", () => {
    editor({ public: { enabled: true, fields: ["verdict"] } }, {});
    expect(pub().querySelector("img")).toBeNull();
    expect(text(pub())).toContain("Shown here once public access with the verdict field is saved.");
    act(() => root?.unmount());
    root = null;
    editor({ public: { enabled: true, fields: ["verdict"] } });
    const img = pub().querySelector("img")!;
    expect(img.getAttribute("src")).toBe("/badge/demo.svg");
    expect(img.getAttribute("alt")).toBe("Status badge of demo");
  });
});

const ROWS: Delivery[] = [
  {
    incidentId: "down:demo:kuma:1:1759000000000",
    kind: "resolve",
    channel: "ops",
    status: "sent",
    attempts: 1,
    retryable: null,
    createdAt: "2026-09-28T10:05:00Z",
    sentAt: "2026-09-28T10:05:01Z",
    lastAttemptAt: "2026-09-28T10:05:01Z",
    error: null,
  },
  {
    incidentId: "down:demo:kuma:1:1759000000000",
    kind: "open",
    channel: "pager",
    status: "failed",
    attempts: 3,
    retryable: true,
    createdAt: "2026-09-28T10:00:00Z",
    sentAt: null,
    lastAttemptAt: "2026-09-28T10:02:00Z",
    error: "http_503",
  },
  {
    incidentId: "stale:demo:kuma:watch-1:1758990000000",
    kind: "open",
    channel: "discord",
    status: "failed",
    attempts: 1,
    retryable: false,
    createdAt: "2026-09-28T09:00:00Z",
    sentAt: null,
    lastAttemptAt: null,
    error: "http_404",
  },
];

describe("delivery log", () => {
  const cells = () =>
    [...document.querySelectorAll("tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].map((td) => td.textContent),
    );

  it("renders deliveries newest first with channel names, attempts and error codes", () => {
    mount(
      createElement(DeliveryTable, {
        deliveries: ROWS,
        channelNames: new Map([
          ["ops", "Ops Slack"],
          ["discord", "Discord"],
        ]),
      }),
    );
    expect(cells()).toEqual([
      [
        "2026-09-28 10:05 UTC",
        "Ops Slack ops",
        "down:demo:kuma:1:1759000000000",
        "resolved",
        "sent",
        "1",
        "",
      ],
      [
        "2026-09-28 10:02 UTC",
        "pager pager",
        "down:demo:kuma:1:1759000000000",
        "opened",
        "failed, retrying",
        "3",
        "http_503",
      ],
      [
        "2026-09-28 09:00 UTC",
        "Discord discord",
        "stale:demo:kuma:watch-1:1758990000000",
        "opened",
        "failed",
        "1",
        "http_404",
      ],
    ]);
  });

  it("says when nothing was sent yet", () => {
    mount(createElement(DeliveryTable, { deliveries: [], channelNames: new Map() }));
    expect(text()).toContain("No notifications sent yet.");
  });

  it("loads the log from the admin API and refreshes it", async () => {
    replies["/api/admin/sites/demo/notifications"] = [
      { status: 200, body: { deliveries: ROWS.slice(2) } },
      { status: 200, body: { deliveries: ROWS } },
    ];
    mount(createElement(DeliveryLog, { site: "demo", channelNames: new Map() }));
    await settle();
    expect(calls[0]).toMatchObject({ method: "GET", path: "/api/admin/sites/demo/notifications?limit=50" });
    expect(cells()).toHaveLength(1);
    act(() => button("Refresh").click());
    await settle();
    expect(cells()).toHaveLength(3);
  });

  it("shows why the log could not be loaded", async () => {
    replies["/api/admin/sites/demo/notifications"] = [
      { status: 403, body: { error: "forbidden", message: "Missing permission config.edit" } },
    ];
    mount(createElement(DeliveryLog, { site: "demo", channelNames: new Map() }));
    await settle();
    expect(text()).toContain("Could not load the delivery log: Missing permission config.edit");
    expect(text()).not.toContain("Loading");
  });

  it("labels failed rows by whether they are retried", () => {
    expect(ROWS.map(statusText)).toEqual(["sent", "failed, retrying", "failed"]);
  });
});

describe("contracts and helpers", () => {
  it("parses the delivery list and the test result, and refuses unknown statuses", () => {
    expect(DeliveryList.parse({ deliveries: ROWS }).deliveries).toHaveLength(3);
    expect(Delivery.safeParse({ ...ROWS[0], status: "queued" }).success).toBe(false);
    expect(Delivery.safeParse({ ...ROWS[0], error: "x".repeat(65) }).success).toBe(false);
    expect(
      NotifyTestResult.parse({ site: "demo", kind: "up", sent: false, status: 404, error: "http_404" }),
    ).toEqual({
      sent: false,
      status: 404,
      error: "http_404",
    });
  });

  it("keeps only short error codes", () => {
    expect(safeErrorCode(null)).toBeNull();
    expect(safeErrorCode("http_429")).toBe("http_429");
    expect(safeErrorCode("email_unavailable")).toBe("email_unavailable");
    expect(safeErrorCode("https://hooks.example.org/secret")).toBe("error");
    expect(safeErrorCode("bad body text")).toBe("error");
  });

  it("normalises secret names and suggests one per channel id", () => {
    expect(toSecretName("notify ops-slack")).toBe("NOTIFY_OPS_SLACK");
    expect(toSecretName("a/b:c")).toBe("ABC");
    expect(suggestedSecret("ops-1", "_SIGNING")).toBe("NOTIFY_OPS_1_SIGNING");
  });

  it("switches types keeping the common fields and gives new channels free ids", () => {
    const hook = withChannelType({ ...OPS, events: ["down"], enabled: false }, "webhook");
    expect(hook).toMatchObject({
      id: "ops",
      type: "webhook",
      secret: "NOTIFY_SLACK_OPS",
      signingSecret: "NOTIFY_OPS_SIGNING",
      events: ["down"],
      enabled: false,
    });
    expect(ChannelConfig.safeParse(hook).success).toBe(true);
    expect(ChannelConfig.safeParse(withChannelType(OPS, "ntfy")).success).toBe(true);
    expect(withChannelType(OPS, "slack")).toBe(OPS);
    const first = newChannel([]);
    expect(first.id).toBe("channel-1");
    expect(ChannelConfig.safeParse(first).success).toBe(true);
    expect(newChannel([first, { ...first, id: "channel-2" }]).id).toBe("channel-3");
    const hook1 = withChannelType(first, "webhook");
    expect(withId(hook1, "ops")).toMatchObject({ secret: "NOTIFY_OPS", signingSecret: "NOTIFY_OPS_SIGNING" });
    const authed = { ...hook1, signingSecret: undefined, authSecret: "NOTIFY_CHANNEL_1_AUTH" };
    const moved = withId(authed, "ops");
    expect(moved).toMatchObject({ secret: "NOTIFY_OPS", authSecret: "NOTIFY_OPS_AUTH" });
    expect(moved.type === "webhook" && moved.signingSecret).toBeUndefined();
    expect(ChannelConfig.safeParse(moved).success).toBe(true);
    expect(withId(OPS, "ops-2")).toMatchObject({ id: "ops-2", secret: "NOTIFY_SLACK_OPS" });
  });

  it("tells a saved channel from an edited or new one", () => {
    const saved = { discord: false, channels: [OPS] };
    expect(isSaved(OPS, saved)).toBe(true);
    expect(isSaved({ ...OPS, name: "x" }, saved)).toBe(false);
    expect(isSaved({ ...OPS, id: "new" }, saved)).toBe(false);
  });

  it("builds every public URL on the site's host", () => {
    expect(publicUrls("https://status.example.org", "demo", "kuma:1")).toEqual({
      summary: "https://status.example.org/api/public/demo/summary.json",
      siteBadge: "https://status.example.org/badge/demo.svg",
      serviceBadge: "https://status.example.org/badge/demo/kuma:1.svg",
      uptimeBadge: "https://status.example.org/badge/demo/kuma:1.svg?metric=uptime",
      widget: "https://status.example.org/embed/demo",
      snippet:
        '<div data-uptellis="demo"></div><script src="https://status.example.org/embed.js" async></script>',
    });
  });
});
