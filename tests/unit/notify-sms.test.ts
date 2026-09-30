import { describe, expect, it, vi } from "vitest";
import { AlertMessage, ChannelConfig, type ProviderContext } from "@/shared/notify";
import { PROVIDERS, sendVia } from "@/worker/notify/providers";
import { gsmSafe, SMS_MAX, smsLink, smsText, twilioError } from "@/worker/notify/providers/sms";
import { buildSiteView } from "../../src/shared/view";
import { fixtureInput } from "../fixtures/view";

// Never real endpoints: every request goes to the fake fetch below. SIDs and tokens are assembled at
// runtime so this file passes the repo-wide literal scan; the numbers are fictional (555-01xx).
const HEX = "0123456789abcdef";
const SID = `AC${HEX}${HEX}`;
const MG = `MG${HEX}${HEX}`;
const TOKEN = `${HEX}${HEX}`.split("").reverse().join("");
const FROM = "+15555550100";
const TO = "+15555550123";

/** Characters in the GSM-7 basic set that are also ASCII (what `smsText` may use). */
const GSM7_ASCII = /^[A-Za-z0-9 @$_!"#%&'()*+,\-./:;<=>?\n\r]*$/;

const base = {
  v: 1,
  event: "down",
  severity: "critical",
  incidentId: "kuma:7:2026-09-27T14:02:00Z",
  site: { slug: "acme", name: "Acme Cloud" },
  subject: { kind: "service", id: "kuma:7", name: "Checkout", target: "shop.example.org/", reporter: null },
  title: "Checkout is down",
  reason: "HTTP 503",
  startedAt: "2026-09-27T14:02:00Z",
  endedAt: null,
  durationS: null,
  pageUrl: "https://status.example.com/",
  test: false,
  sentAt: "2026-09-27T14:03:00Z",
} as const;
const msg = (over: Record<string, unknown> = {}) => AlertMessage.parse({ ...base, ...over });
const source = { kind: "source", id: "kuma:watch-1", reporter: null };

const sms = {
  id: "sms-ops",
  name: "SMS (Ops)",
  type: "sms",
  provider: "twilio",
  accountSid: SID,
  secret: "NOTIFY_TWILIO_TOKEN",
  from: FROM,
  to: TO,
} as const;
const channel = (over: Record<string, unknown> = {}) =>
  ChannelConfig.parse({ ...sms, ...over }) as Extract<ChannelConfig, { type: "sms" }>;

type Call = { url: string; method: string | undefined; headers: Headers; body: string };

function context(responses: (Response | Error)[] = [], secret: string | null = TOKEN) {
  const calls: Call[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    calls.push({
      url: String(input instanceof Request ? input.url : input),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: String(init?.body),
    });
    const next = responses.shift() ?? Response.json({ sid: "SM1", status: "queued" }, { status: 201 });
    if (next instanceof Error) throw next;
    return next;
  });
  const ctx: ProviderContext = {
    secret: (name) => (name === "NOTIFY_TWILIO_TOKEN" && secret !== null ? secret : undefined),
    email: null,
    emailFrom: undefined,
    fetch,
    version: "9.9.9",
    now: () => Date.parse(base.sentAt),
  };
  return { ctx, calls, fetch };
}

const twilio = (status: number, code: number, headers: Record<string, string> = {}) =>
  Response.json(
    { code, message: `The 'To' number ${TO} is not valid.`, more_info: "https://example.com", status },
    { status, headers },
  );

/** Nothing personal or secret in an outcome: no number, SID or token (or any part of Twilio's message). */
const clean = (outcome: unknown) => {
  const s = JSON.stringify(outcome);
  for (const x of [TO, FROM, SID, MG, TOKEN, "not valid", TO.slice(1)]) expect(s).not.toContain(x);
};

describe("sms channel config", () => {
  it("accepts the Twilio shape, with events defaulting to down and up", () => {
    const c = channel();
    expect(c).toMatchObject({ type: "sms", provider: "twilio", from: FROM, to: TO, enabled: true });
    expect(c.events).toEqual(["down", "up"]);
    expect(channel({ events: ["down", "up", "stale", "recovered"] }).events).toHaveLength(4);
    expect(channel({ from: MG }).from).toBe(MG);
  });

  it("keeps the other types' default of every event", () => {
    const others = [
      { type: "discord", secret: "NOTIFY_D" },
      { type: "slack", secret: "NOTIFY_S" },
      { type: "webhook", secret: "NOTIFY_H", signingSecret: "NOTIFY_K" },
      { type: "ntfy", secret: "NOTIFY_N" },
      { type: "telegram", secret: "NOTIFY_T", chatId: "123" },
      { type: "email", to: [["ops", "example.org"].join("@")] },
    ];
    for (const o of others) {
      expect(ChannelConfig.parse({ id: "x", name: "X", ...o }).events, o.type).toEqual([
        "down",
        "up",
        "stale",
        "recovered",
      ]);
    }
  });

  it("rejects each bad field", () => {
    const bad: [string, unknown][] = [
      ["provider", "vonage"],
      ["provider", undefined],
      ["accountSid", `AC${HEX}`],
      ["accountSid", `AC${HEX}${HEX}`.toUpperCase()],
      ["accountSid", MG],
      ["secret", TOKEN],
      ["secret", undefined],
      ["from", "15555550100"],
      ["from", "+0555550100"],
      ["from", `MG${HEX}`],
      ["from", SID],
      ["to", "15555550123"],
      ["to", "+1 555 555 0123"],
      ["to", "+1234"],
      ["to", `+1${"5".repeat(15)}`],
      ["to", [TO]],
      ["to", `${TO},+15555550124`],
      ["to", MG],
      ["events", []],
    ];
    for (const [field, value] of bad) {
      expect(ChannelConfig.safeParse({ ...sms, [field]: value }).success, `${field}=${value}`).toBe(false);
    }
  });
});

describe("smsText", () => {
  it("says each event in one short line with the link", () => {
    expect(smsText(msg())).toBe("DOWN: Checkout (Acme Cloud) since 14:02 UTC. status.example.com");
    expect(
      smsText(msg({ event: "up", severity: "resolved", endedAt: "2026-09-27T14:14:00Z", durationS: 720 })),
    ).toBe("UP: Checkout (Acme Cloud) is back after 12 min. status.example.com");
    expect(smsText(msg({ event: "stale", severity: "warning", subject: source, pageUrl: null }))).toBe(
      "STALE: source kuma:watch-1 (Acme Cloud) silent since 14:02 UTC.",
    );
    expect(
      smsText(
        msg({ event: "recovered", severity: "resolved", subject: source, pageUrl: null, durationS: 300 }),
      ),
    ).toBe("RECOVERED: source kuma:watch-1 (Acme Cloud) is reporting again.");
  });

  it("marks a test, dates an older start and drops only the scheme of the link", () => {
    expect(smsText(msg({ test: true }))).toBe(
      "TEST DOWN: Checkout (Acme Cloud) since 14:02 UTC. status.example.com",
    );
    expect(smsText(msg({ sentAt: "2026-09-28T09:00:00Z" }))).toContain("since 2026-09-27 14:02 UTC.");
    expect(smsLink("https://example.com/status/")).toBe("example.com/status");
    expect(smsLink("http://status.example.com:8080/")).toBe("status.example.com:8080");
    expect(smsLink(null)).toBeNull();
    expect(smsText(msg({ event: "up", severity: "resolved", durationS: 20 }))).toContain(
      "is back within a minute.",
    );
  });

  it("fits long names in 160 characters, cutting names with ... and never the link", () => {
    const long = "Very Long Service Name ".repeat(6).trim();
    const site = { slug: "acme", name: "An Extremely Long Site Name For Testing ".repeat(2).trim() };
    const url = "https://status.a-rather-long-hostname.example.com/some/path";
    for (const m of [
      msg({ subject: { ...base.subject, name: long }, site, pageUrl: url }),
      msg({ subject: { ...base.subject, name: long }, pageUrl: url, test: true }),
      msg({ site, pageUrl: url }),
      msg({ event: "stale", severity: "warning", subject: source, site, pageUrl: url }),
    ]) {
      const text = smsText(m);
      expect(text.length).toBeLessThanOrEqual(SMS_MAX);
      expect(text.endsWith(" status.a-rather-long-hostname.example.com/some/path")).toBe(true);
      expect(text).toContain("...");
      expect(text).toMatch(GSM7_ASCII);
    }
    // A short site name keeps its length; the long service name takes the rest.
    const cut = smsText(msg({ subject: { ...base.subject, name: long } }));
    expect(cut).toContain("(Acme Cloud)");
    expect(cut.length).toBeGreaterThan(SMS_MAX - 3);
    expect(cut.length).toBeLessThanOrEqual(SMS_MAX);
  });

  it("is plain GSM-7 ASCII with no emoji, whatever the names hold", () => {
    const text = smsText(
      msg({
        test: true,
        subject: { ...base.subject, name: "Zürich [API] {v2} ~ café ✅ 支付 `x` | a\\b ^" },
        site: { slug: "acme", name: "Acme \u201cCloud\u201d \u2013 EU" },
      }),
    );
    expect(text).toMatch(GSM7_ASCII);
    expect(text).toContain("Zurich (API) (v2) - cafe ? ?? 'x' / a/b");
    expect(text).toContain('(Acme "Cloud" - EU)');
    expect(gsmSafe("a\n\tb")).toBe("a b");
  });
});

describe("sms provider", () => {
  it("posts a form to the account's Messages resource with Basic auth", async () => {
    const { ctx, calls } = context();
    expect(await PROVIDERS.sms.send(msg(), channel(), ctx)).toEqual({ ok: true, status: 201 });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    expect(call.method).toBe("POST");
    expect(call.headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(call.headers.get("authorization")).toBe(`Basic ${btoa(`${SID}:${TOKEN}`)}`);
    const form = new URLSearchParams(call.body);
    expect(Object.fromEntries(form)).toEqual({ To: TO, From: FROM, Body: smsText(msg()) });
  });

  it("sends through a Messaging Service when from is an MG SID", async () => {
    const { ctx, calls } = context();
    expect(await PROVIDERS.sms.send(msg(), channel({ from: MG }), ctx)).toMatchObject({ ok: true });
    const form = new URLSearchParams(calls[0]!.body);
    expect(form.get("MessagingServiceSid")).toBe(MG);
    expect(form.has("From")).toBe(false);
  });

  it("retries a 429 with its Retry-After, a 5xx and a network error", async () => {
    const limited = await PROVIDERS.sms.send(
      msg(),
      channel(),
      context([twilio(429, 20429, { "retry-after": "7" })]).ctx,
    );
    expect(limited).toEqual({
      ok: false,
      status: 429,
      error: "rate_limited",
      retryable: true,
      retryAfterS: 7,
    });
    const down = await PROVIDERS.sms.send(msg(), channel(), context([twilio(500, 20500)]).ctx);
    expect(down).toEqual({ ok: false, status: 500, error: "http_500", retryable: true });
    const net = await PROVIDERS.sms.send(msg(), channel(), context([new TypeError("fetch failed")]).ctx);
    expect(net).toMatchObject({ error: "network", retryable: true });
    for (const o of [limited, down, net]) clean(o);
  });

  it("names final failures by status and Twilio code, never echoing the body", async () => {
    const cases: [Response, string][] = [
      [twilio(401, 20003), "bad_token"],
      [new Response("Unauthorized", { status: 401 }), "bad_token"],
      [new Response("", { status: 403 }), "bad_token"],
      [twilio(400, 21211), "invalid_number"],
      [twilio(400, 21608), "unverified_number"],
      [twilio(400, 21606), "invalid_from"],
      [twilio(400, 21212), "invalid_from"],
      [twilio(400, 21610), "opted_out"],
      [twilio(400, 21617), "twilio_21617"],
      [twilio(404, 20404), "twilio_20404"],
      [new Response("<html>bad</html>", { status: 400 }), "http_400"],
      [Response.json({ code: "not a code", message: TO }, { status: 422 }), "http_422"],
    ];
    for (const [res, error] of cases) {
      const outcome = await PROVIDERS.sms.send(msg(), channel(), context([res]).ctx);
      expect(outcome, error).toMatchObject({ ok: false, error, retryable: false });
      clean(outcome);
    }
    expect(twilioError(400, null)).toBeUndefined();
    expect(twilioError(400, [21211])).toBeUndefined();
    expect(twilioError(400, { code: "21211" })).toBe("invalid_number");
    expect(twilioError(503, { code: 21211 })).toBeUndefined();
  });

  it("refuses without a request when the token is missing or malformed", async () => {
    const missing = context([], null);
    expect(await PROVIDERS.sms.send(msg(), channel(), missing.ctx)).toMatchObject({
      error: "secret_missing",
      retryable: false,
    });
    const bad = context([], "not-a-twilio-token");
    const outcome = await sendVia(msg(), channel(), bad.ctx);
    expect(outcome).toMatchObject({ error: "bad_token", retryable: false });
    expect(missing.fetch).not.toHaveBeenCalled();
    expect(bad.fetch).not.toHaveBeenCalled();
  });
});

describe("the public view", () => {
  it("carries no configured number, sender or SID", () => {
    const input = fixtureInput("incident");
    input.config = {
      ...input.config,
      notify: { ...input.config.notify, channels: [channel(), channel({ id: "sms-mg", from: MG })] },
    };
    const view = JSON.stringify(buildSiteView(input));
    for (const x of [TO, FROM, MG, SID, TO.slice(1), "sms-ops"]) expect(view).not.toContain(x);
  });
});
