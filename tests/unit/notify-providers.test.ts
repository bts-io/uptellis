import { describe, expect, it, vi } from "vitest";
import { bindingEmailSender } from "@/platform/cloudflare/email";
import {
  AlertMessage,
  ChannelConfig,
  DELIVERY_HEADER,
  EVENT_HEADER,
  type ProviderContext,
  SIGNATURE_HEADER,
  verifyWebhook,
} from "@/shared/notify";
import { downMessage, staleMessage, upMessage } from "@/worker/notify/alerts";
import { alertCard, downCard } from "@/worker/notify/card";
import { textSummary } from "@/worker/notify/format";
import { PROVIDERS, sendVia } from "@/worker/notify/providers";
import { emailHtml, emailSubject } from "@/worker/notify/providers/email";
import { headerSafe } from "@/worker/notify/providers/ntfy";
import { slackEscape } from "@/worker/notify/providers/slack";
import { htmlEscape, telegramText } from "@/worker/notify/providers/telegram";
import { deliveryId } from "@/worker/notify/providers/webhook";

// Never real endpoints: every request goes to the fake fetch below.
const HOOK = "https://hooks.example.org/services/T0/B0/x";
const NTFY = "https://ntfy.example.org/uptellis-ops";
const BOT = `123456:${"a".repeat(30)}`;
const SIGNING = "test-signing-secret";
const PAGE = "https://status.example.com/";
const NOW = Date.parse("2026-09-27T10:07:30Z");
const T = (hms: string) => `2026-09-27T${hms}Z`;
const addr = (user: string) => [user, "example.org"].join("@");

const service = {
  id: "kuma:7",
  source: "kuma:watch-1",
  targetDisplay: "shop.example.org/",
  name: "Checkout",
};
const downIncident = {
  id: `kuma:7:${T("10:00:00")}`,
  site: "demo",
  kind: "down" as const,
  serviceId: "kuma:7",
  sourceId: null,
  startedAt: T("10:00:00"),
  endedAt: null,
  title: "Checkout down",
  notes: null,
};
const down = AlertMessage.parse(
  downMessage({
    site: "demo",
    siteName: "Demo & Co",
    incident: downIncident,
    service,
    reason: "HTTP 503 <html>",
    pageUrl: PAGE,
    now: NOW,
  }),
);
const up = AlertMessage.parse(
  upMessage({
    site: "demo",
    incident: { ...downIncident, endedAt: T("10:43:00") },
    service,
    pageUrl: PAGE,
    now: NOW,
  }),
);
const stale = AlertMessage.parse(
  staleMessage({
    site: "demo",
    incident: {
      ...downIncident,
      id: `kuma:watch-1:${T("10:05:00")}`,
      kind: "stale",
      serviceId: null,
      sourceId: "kuma:watch-1",
      startedAt: T("10:05:00"),
    },
    sources: [],
    pageUrl: null,
    now: NOW,
    test: true,
  }),
);

const SECRETS: Record<string, string> = {
  NOTIFY_HOOK: HOOK,
  NOTIFY_NTFY: NTFY,
  NOTIFY_NTFY_TOKEN: "tk_ntfytoken",
  NOTIFY_TG: BOT,
  NOTIFY_SIGNING: SIGNING,
};

type Call = { url: string; headers: Headers; body: string };

function context(responses: (Response | Error)[] = [], extra: Partial<ProviderContext> = {}) {
  const calls: Call[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    calls.push({
      url: String(input instanceof Request ? input.url : input),
      headers: new Headers(init?.headers),
      body: String(init?.body),
    });
    const next = responses.shift() ?? new Response("ok");
    if (next instanceof Error) throw next;
    return next;
  });
  const ctx: ProviderContext = {
    secret: (name) => SECRETS[name],
    email: null,
    emailFrom: undefined,
    fetch,
    version: "9.9.9",
    now: () => NOW,
    ...extra,
  };
  return { ctx, calls, fetch };
}

const channel = <T extends ChannelConfig["type"]>(c: { type: T } & Record<string, unknown>) =>
  ChannelConfig.parse({ id: "ch", name: "Ch", ...c }) as Extract<ChannelConfig, { type: T }>;

describe("discord provider", () => {
  const ch = channel({ type: "discord", secret: "NOTIFY_HOOK" });

  it("posts the Components V2 card with wait and components, under a timeout", async () => {
    const { ctx, calls, fetch } = context([Response.json({ id: "1" })]);
    expect(await PROVIDERS.discord.send(down, ch, ctx)).toEqual({ ok: true, status: 200 });
    const u = new URL(calls[0]!.url);
    expect(u.origin + u.pathname).toBe(HOOK);
    expect(u.searchParams.get("wait")).toBe("true");
    expect(u.searchParams.get("with_components")).toBe("true");
    expect(calls[0]!.headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(calls[0]!.body)).toEqual(alertCard(down));
    expect(fetch.mock.calls[0]![1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("renders exactly the card the down card builder does", () => {
    const card = downCard({
      site: "demo",
      incident: downIncident,
      service,
      reason: "HTTP 503 <html>",
      pageUrl: PAGE,
      now: NOW,
    });
    expect(alertCard(down)).toEqual(card);
  });

  it("maps Discord's answers to outcomes", async () => {
    const run = async (r: Response | Error) => PROVIDERS.discord.send(down, ch, context([r]).ctx);
    expect(await run(Response.json({ retry_after: 1.5 }, { status: 429 }))).toEqual({
      ok: false,
      status: 429,
      error: "rate_limited",
      retryable: true,
      retryAfterS: 1.5,
    });
    expect(await run(Response.json({}, { status: 500 }))).toMatchObject({
      error: "http_500",
      retryable: true,
    });
    expect(await run(Response.json({}, { status: 404 }))).toMatchObject({
      error: "http_404",
      retryable: false,
    });
    const timeout = Object.assign(new Error("slow"), { name: "TimeoutError" });
    expect(await run(timeout)).toEqual({ ok: false, status: 0, error: "timeout", retryable: true });
    expect(await run(new TypeError("reset"))).toMatchObject({ error: "network", retryable: true });
  });

  it("refuses a missing secret or a bad URL without a request", async () => {
    const { ctx, fetch } = context();
    const missing = channel({ type: "discord", secret: "NOTIFY_NOPE" });
    expect(await PROVIDERS.discord.send(down, missing, ctx)).toEqual({
      ok: false,
      status: 0,
      error: "secret_missing",
      retryable: false,
    });
    const bad = context([], { secret: () => "not a url" });
    expect(await PROVIDERS.discord.send(down, ch, bad.ctx)).toMatchObject({
      error: "bad_url",
      retryable: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("slack provider", () => {
  const ch = channel({ type: "slack", secret: "NOTIFY_HOOK" });

  it("posts Block Kit in a coloured attachment: header, fields, button, context", async () => {
    const { ctx, calls } = context();
    expect(await PROVIDERS.slack.send(down, ch, ctx)).toEqual({ ok: true, status: 200 });
    expect(calls[0]!.url).toBe(HOOK);
    const body = JSON.parse(calls[0]!.body);
    expect(body.text).toBe("🔴 Uptellis: Checkout is down");
    const [att] = body.attachments;
    expect(att.color).toBe("#dc2626");
    expect(att.blocks.map((b: { type: string }) => b.type)).toEqual([
      "header",
      "section",
      "section",
      "actions",
      "context",
    ]);
    expect(att.blocks[0].text).toEqual({
      type: "plain_text",
      text: "🔴 Uptellis: Checkout is down",
      emoji: true,
    });
    const fields = att.blocks[2].fields.map((f: { text: string }) => f.text);
    expect(fields).toContain("*Service*\nkuma:7");
    // Escaped: Slack reads `<...>` as a link or a mention.
    expect(fields).toContain("*Reason*\nHTTP 503 &lt;html&gt;");
    expect(att.blocks[3].elements[0].url).toBe(PAGE);
    expect(att.blocks[4].elements[0].text).toBe("Uptellis · demo · 2026-09-27 10:07 UTC");
  });

  it("labels a test and escapes Slack's control characters", async () => {
    const { ctx, calls } = context();
    await PROVIDERS.slack.send(stale, ch, ctx);
    const body = JSON.parse(calls[0]!.body);
    expect(body.text).toBe("🚨 TEST: Uptellis: kuma:watch-1 went silent");
    expect(body.attachments[0].color).toBe("#7f1d1d");
    // No page URL: no button.
    expect(body.attachments[0].blocks.some((b: { type: string }) => b.type === "actions")).toBe(false);
    expect(slackEscape("a & <b> c")).toBe("a &amp; &lt;b&gt; c");
  });

  it("honours Retry-After on a 429", async () => {
    const res = new Response("rate_limited", { status: 429, headers: { "retry-after": "7" } });
    expect(await PROVIDERS.slack.send(down, ch, context([res]).ctx)).toMatchObject({
      retryable: true,
      retryAfterS: 7,
    });
  });
});

describe("webhook provider", () => {
  const ch = channel({ type: "webhook", secret: "NOTIFY_HOOK", signingSecret: "NOTIFY_SIGNING" });

  it("posts the message JSON, signed, with the event and a stable delivery id", async () => {
    const { ctx, calls } = context([new Response(null, { status: 204 })]);
    expect(await PROVIDERS.webhook.send(down, ch, ctx)).toEqual({ ok: true, status: 204 });
    const call = calls[0]!;
    expect(call.url).toBe(HOOK);
    expect(JSON.parse(call.body)).toEqual(down);
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.headers.get("user-agent")).toBe("uptellis/9.9.9");
    expect(call.headers.get(EVENT_HEADER)).toBe("down");
    expect(call.headers.get(DELIVERY_HEADER)).toMatch(/^[0-9a-f]{32}$/);
    const signature = call.headers.get(SIGNATURE_HEADER)!;
    expect(signature).toMatch(new RegExp(`^t=${Math.floor(NOW / 1000)},v1=[0-9a-f]{64}$`));
    expect(await verifyWebhook(SIGNING, call.body, signature, Math.floor(NOW / 1000))).toBe(true);
    expect(await verifyWebhook("other", call.body, signature, Math.floor(NOW / 1000))).toBe(false);

    // A retry of the same delivery carries the same id; another event or channel does not.
    const again = context([new Response(null, { status: 204 })]);
    await PROVIDERS.webhook.send(down, ch, again.ctx);
    expect(again.calls[0]!.headers.get(DELIVERY_HEADER)).toBe(call.headers.get(DELIVERY_HEADER));
    expect(await deliveryId(up, "ch")).not.toBe(await deliveryId(down, "ch"));
    expect(await deliveryId(down, "other")).not.toBe(await deliveryId(down, "ch"));
  });

  it("needs both secrets", async () => {
    const noKey = channel({ type: "webhook", secret: "NOTIFY_HOOK", signingSecret: "NOTIFY_NOPE" });
    expect(await PROVIDERS.webhook.send(down, noKey, context().ctx)).toMatchObject({
      error: "secret_missing",
    });
  });
});

describe("ntfy provider", () => {
  it("posts the text with title, priority, tags, click and the bearer token", async () => {
    const ch = channel({ type: "ntfy", secret: "NOTIFY_NTFY", tokenSecret: "NOTIFY_NTFY_TOKEN" });
    const { ctx, calls } = context();
    expect(await PROVIDERS.ntfy.send(down, ch, ctx)).toEqual({ ok: true, status: 200 });
    const call = calls[0]!;
    expect(call.url).toBe(NTFY);
    expect(call.headers.get("title")).toBe("Uptellis: Checkout is down");
    expect(call.headers.get("priority")).toBe("5");
    expect(call.headers.get("tags")).toBe("red_circle");
    expect(call.headers.get("click")).toBe(PAGE);
    expect(call.headers.get("authorization")).toBe(["Bearer", "tk_ntfytoken"].join(" "));
    expect(call.body).toBe(textSummary(down, { heading: false }));
    expect(call.body).toContain("Reason: HTTP 503 <html>");
  });

  it("sets priority per event, tags a test and leaves out what is absent", async () => {
    const ch = channel({ type: "ntfy", secret: "NOTIFY_NTFY" });
    const staleCall = context();
    await PROVIDERS.ntfy.send(stale, ch, staleCall.ctx);
    const h = staleCall.calls[0]!.headers;
    expect(h.get("priority")).toBe("4");
    expect(h.get("tags")).toBe("rotating_light,test");
    expect(h.get("title")).toBe("TEST: Uptellis: kuma:watch-1 went silent");
    expect(h.get("click")).toBeNull();
    expect(h.get("authorization")).toBeNull();
    const upCall = context();
    await PROVIDERS.ntfy.send(up, ch, upCall.ctx);
    expect(upCall.calls[0]!.headers.get("priority")).toBe("3");
  });

  it("encodes a non-ASCII title and refuses a named token that is unset", async () => {
    expect(headerSafe("Café down")).toBe(`=?UTF-8?B?${btoa("CafÃ© down")}?=`);
    const ch = channel({ type: "ntfy", secret: "NOTIFY_NTFY", tokenSecret: "NOTIFY_NOPE" });
    expect(await PROVIDERS.ntfy.send(down, ch, context().ctx)).toMatchObject({ error: "secret_missing" });
  });
});

describe("telegram provider", () => {
  const ch = channel({ type: "telegram", secret: "NOTIFY_TG", chatId: "-1001234567890" });

  it("sends HTML with the chat id and no link preview", async () => {
    const { ctx, calls } = context([Response.json({ ok: true })]);
    expect(await PROVIDERS.telegram.send(down, ch, ctx)).toEqual({ ok: true, status: 200 });
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT}/sendMessage`);
    const body = JSON.parse(calls[0]!.body);
    expect(body).toMatchObject({
      chat_id: "-1001234567890",
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    expect(body.text).toBe(telegramText(down));
    expect(body.text.split("\n")[0]).toBe("<b>🔴 Uptellis: Checkout is down</b>");
    expect(body.text).toContain("<b>Reason:</b> HTTP 503 &lt;html&gt;");
    expect(body.text).toContain(`<a href="${PAGE}">Status page</a>`);
    expect(htmlEscape(`a&b<c>"d"`)).toBe("a&amp;b&lt;c&gt;&quot;d&quot;");
  });

  it("honours retry_after, and refuses a malformed token without a request", async () => {
    const limited = Response.json(
      { ok: false, error_code: 429, parameters: { retry_after: 12 } },
      { status: 429 },
    );
    expect(await PROVIDERS.telegram.send(down, ch, context([limited]).ctx)).toMatchObject({
      retryAfterS: 12,
      retryable: true,
    });
    const bad = context([], { secret: () => "nope" });
    expect(await PROVIDERS.telegram.send(down, ch, bad.ctx)).toMatchObject({ error: "bad_token" });
    expect(bad.fetch).not.toHaveBeenCalled();
    expect(
      await PROVIDERS.telegram.send(down, ch, context([Response.json({}, { status: 403 })]).ctx),
    ).toMatchObject({ error: "http_403", retryable: false });
  });
});

describe("email provider", () => {
  const ch = channel({ type: "email", to: [addr("ops"), addr("oncall")] });

  it("sends subject, text and HTML through the instance's sender", async () => {
    const send = vi.fn(async () => ({ ok: true as const, status: 200 }));
    const { ctx } = context([], { email: { send }, emailFrom: addr("status") });
    expect(await PROVIDERS.email.send(down, ch, ctx)).toEqual({ ok: true, status: 200 });
    expect(send).toHaveBeenCalledWith({
      from: addr("status"),
      to: [addr("ops"), addr("oncall")],
      subject: "[Uptellis] Checkout is down",
      text: textSummary(down),
      html: emailHtml(down),
    });
    expect(emailSubject(stale)).toBe("[Uptellis] TEST: kuma:watch-1 went silent");
    expect(emailHtml(down)).toContain("HTTP 503 &lt;html&gt;");
    expect(emailHtml(down)).toContain("border-left:4px solid #dc2626");
  });

  it("prefers the channel's from, and fails final without a sender or a from", async () => {
    const send = vi.fn(async () => ({ ok: true as const, status: 200 }));
    const own = channel({ type: "email", to: [addr("ops")], from: addr("alerts") });
    await PROVIDERS.email.send(down, own, context([], { email: { send }, emailFrom: addr("status") }).ctx);
    expect(send.mock.calls[0]).toMatchObject([{ from: addr("alerts") }]);
    expect(await PROVIDERS.email.send(down, ch, context().ctx)).toEqual({
      ok: false,
      status: 0,
      error: "email_unavailable",
      retryable: false,
    });
    expect(await PROVIDERS.email.send(down, ch, context([], { email: { send } }).ctx)).toMatchObject({
      error: "email_no_from",
      retryable: false,
    });
  });

  it("maps the Cloudflare binding's errors", async () => {
    const failing = (code: string) =>
      bindingEmailSender({ send: async () => Promise.reject(Object.assign(new Error("x"), { code })) });
    const msg = { from: addr("status"), to: [addr("ops")], subject: "s", text: "t", html: "h" };
    expect(await failing("E_RATE_LIMIT_EXCEEDED").send(msg)).toMatchObject({ status: 429, retryable: true });
    expect(await failing("E_SENDER_NOT_VERIFIED").send(msg)).toEqual({
      ok: false,
      status: 0,
      error: "email_sender_not_verified",
      retryable: false,
    });
    expect(await failing("E_SOMETHING_NEW").send(msg)).toMatchObject({
      error: "email_error",
      retryable: true,
    });
    const sent: unknown[] = [];
    const ok = bindingEmailSender({ send: async (m) => void sent.push(m) });
    expect(await ok.send(msg)).toEqual({ ok: true, status: 200 });
    expect(sent).toEqual([msg]);
  });
});

describe("sendVia", () => {
  it("turns a provider that throws into a final internal error", async () => {
    const ch = channel({ type: "email", to: [addr("ops")] });
    const { ctx } = context([], {
      email: {
        send: () => {
          throw new Error("boom");
        },
      },
      emailFrom: addr("status"),
    });
    // The email provider catches its sender; a throwing context accessor reaches sendVia.
    expect(await sendVia(down, ch, ctx)).toMatchObject({ error: "email_error" });
    const broken = {
      ...ctx,
      secret: () => {
        throw new Error("boom");
      },
    };
    expect(await sendVia(down, channel({ type: "slack", secret: "NOTIFY_HOOK" }), broken)).toEqual({
      ok: false,
      status: 0,
      error: "internal",
      retryable: false,
    });
  });
});
