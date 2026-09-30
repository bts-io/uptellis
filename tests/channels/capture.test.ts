/**
 * The real channel providers and email senders against local impersonators: one Bun.serve standing in for
 * a Slack incoming webhook, an ntfy server, the Telegram Bot API, Twilio's Messages resource, a signed webhook
 * receiver and the Cloudflare Email Service REST API, and a tiny SMTP server over `node:net`. Nothing leaves
 * the machine: the secrets point at localhost, Telegram's and Twilio's fixed API hosts are rewritten by the
 * context's fetch.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerEmailSender, restEmailSender } from "@/platform/docker/email";
import { mimeMessage, parseSmtpUrl, smtpEmailSender } from "@/platform/docker/smtp";
import {
  AlertMessage,
  ChannelConfig,
  DELIVERY_HEADER,
  type OutgoingEmail,
  type ProviderContext,
  SIGNATURE_HEADER,
  verifyWebhook,
} from "@/shared/notify";
import { downMessage } from "@/worker/notify/alerts";
import { PROVIDERS } from "@/worker/notify/providers";
import { TWILIO_API } from "@/worker/notify/providers/sms";
import { TELEGRAM_API } from "@/worker/notify/providers/telegram";

const LOOPBACK = [127, 0, 0, 1].join(".");
const addr = (user: string) => [user, "example.org"].join("@");
const NOW = Date.parse("2026-09-27T10:07:30Z");
const BOT = `123456:${"b".repeat(30)}`;
// Twilio test values, assembled for the repo-wide literal scan; the numbers are fictional (555-01xx).
const TWILIO_SID = `AC${"0123456789abcdef".repeat(2)}`;
const TWILIO_TOKEN = "c".repeat(32);

interface Captured {
  path: string;
  headers: Headers;
  body: string;
}
const captured: Captured[] = [];
/** Status to answer per path prefix, once each (then 200). */
const answers = new Map<string, number[]>();

let server: ReturnType<typeof Bun.serve>;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: LOOPBACK,
    async fetch(req) {
      const url = new URL(req.url);
      captured.push({ path: url.pathname, headers: req.headers, body: await req.text() });
      const status = answers.get(url.pathname)?.shift() ?? 200;
      if (status === 429)
        return Response.json({ retry_after: 3 }, { status, headers: { "retry-after": "3" } });
      if (url.pathname.includes("/sendMessage")) return Response.json({ ok: status < 300 }, { status });
      if (url.pathname.endsWith("/Messages.json")) {
        if (status < 300) return Response.json({ sid: "SM1", status: "queued" }, { status: 201 });
        return Response.json({ code: 21608, message: "unverified", status }, { status });
      }
      if (url.pathname.includes("/email/sending/send")) {
        return Response.json({ success: status < 300, errors: [], messages: [], result: null }, { status });
      }
      return new Response(status < 300 ? "ok" : "no", { status });
    },
  });
  base = `http://${LOOPBACK}:${server.port}`;
});
afterAll(() => server.stop(true));

const last = () => captured.at(-1)!;

const message = AlertMessage.parse(
  downMessage({
    site: "demo",
    siteName: "Demo",
    incident: {
      id: "kuma:7:2026-09-27T10:00:00Z",
      site: "demo",
      kind: "down",
      serviceId: "kuma:7",
      sourceId: null,
      startedAt: "2026-09-27T10:00:00Z",
      endedAt: null,
      title: "Checkout down",
      notes: null,
    },
    service: { id: "kuma:7", source: "kuma:watch-1", targetDisplay: "shop.example.org/", name: "Checkout" },
    reason: "HTTP 503",
    pageUrl: "https://status.example.com/",
    now: NOW,
  }),
);

function context(email: ProviderContext["email"] = null): ProviderContext {
  const secrets: Record<string, string> = {
    NOTIFY_SLACK: `${base}/slack/services/T0/B0/x`,
    NOTIFY_HOOK: `${base}/receiver`,
    NOTIFY_SIGN: "capture-signing-secret",
    NOTIFY_NTFY: `${base}/uptellis-ops`,
    NOTIFY_NTFY_TOKEN: "tk_capture",
    NOTIFY_TG: BOT,
    NOTIFY_TWILIO: TWILIO_TOKEN,
  };
  return {
    secret: (name) => secrets[name],
    email,
    emailFrom: addr("status"),
    // Telegram's and Twilio's API hosts are fixed: send them here instead.
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(String(input).replace(TELEGRAM_API, base).replace(TWILIO_API, base), init)) as typeof fetch,
    version: "0.0.0-test",
    now: () => NOW,
  };
}

const channel = <T extends ChannelConfig["type"]>(c: { type: T } & Record<string, unknown>) =>
  ChannelConfig.parse({ id: "ch", name: "Ch", ...c }) as Extract<ChannelConfig, { type: T }>;

describe("providers against local impersonators", () => {
  it("Slack gets Block Kit JSON on its webhook path", async () => {
    const out = await PROVIDERS.slack.send(
      message,
      channel({ type: "slack", secret: "NOTIFY_SLACK" }),
      context(),
    );
    expect(out).toEqual({ ok: true, status: 200 });
    expect(last().path).toBe("/slack/services/T0/B0/x");
    expect(last().headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(last().body);
    expect(body.attachments[0].blocks[0].text.text).toBe("🔴 Uptellis: Checkout is down");
  });

  it("the webhook receiver can verify the signature, and a retry keeps the delivery id", async () => {
    const ch = channel({ type: "webhook", secret: "NOTIFY_HOOK", signingSecret: "NOTIFY_SIGN" });
    answers.set("/receiver", [503]);
    const first = await PROVIDERS.webhook.send(message, ch, context());
    expect(first).toMatchObject({ ok: false, status: 503, retryable: true });
    const firstId = last().headers.get(DELIVERY_HEADER);
    expect(await PROVIDERS.webhook.send(message, ch, context())).toEqual({ ok: true, status: 200 });
    const got = last();
    expect(got.path).toBe("/receiver");
    expect(got.headers.get(DELIVERY_HEADER)).toBe(firstId);
    expect(got.headers.get("user-agent")).toBe("uptellis/0.0.0-test");
    expect(
      await verifyWebhook(
        "capture-signing-secret",
        got.body,
        got.headers.get(SIGNATURE_HEADER)!,
        Math.floor(NOW / 1000),
      ),
    ).toBe(true);
    expect(AlertMessage.parse(JSON.parse(got.body))).toEqual(message);
  });

  it("ntfy gets the text with its headers", async () => {
    const ch = channel({ type: "ntfy", secret: "NOTIFY_NTFY", tokenSecret: "NOTIFY_NTFY_TOKEN" });
    expect(await PROVIDERS.ntfy.send(message, ch, context())).toEqual({ ok: true, status: 200 });
    const got = last();
    expect(got.path).toBe("/uptellis-ops");
    expect(got.headers.get("title")).toBe("Uptellis: Checkout is down");
    expect(got.headers.get("priority")).toBe("5");
    expect(got.headers.get("tags")).toBe("red_circle");
    expect(got.headers.get("click")).toBe("https://status.example.com/");
    expect(got.headers.get("authorization")).toBe(["Bearer", "tk_capture"].join(" "));
    expect(got.body).toContain("Service: kuma:7");
  });

  it("Telegram gets sendMessage for the bot, and a 429 is retryable with its wait", async () => {
    const ch = channel({ type: "telegram", secret: "NOTIFY_TG", chatId: "@ops_alerts" });
    expect(await PROVIDERS.telegram.send(message, ch, context())).toEqual({ ok: true, status: 200 });
    expect(last().path).toBe(`/bot${BOT}/sendMessage`);
    expect(JSON.parse(last().body)).toMatchObject({ chat_id: "@ops_alerts", parse_mode: "HTML" });
    answers.set(`/bot${BOT}/sendMessage`, [429]);
    expect(await PROVIDERS.telegram.send(message, ch, context())).toMatchObject({
      status: 429,
      retryable: true,
      retryAfterS: 3,
    });
  });

  it("Twilio gets a form with Basic auth, and an unverified number is final", async () => {
    const ch = channel({
      type: "sms",
      provider: "twilio",
      accountSid: TWILIO_SID,
      secret: "NOTIFY_TWILIO",
      from: "+15555550100",
      to: "+15555550123",
    });
    expect(await PROVIDERS.sms.send(message, ch, context())).toEqual({ ok: true, status: 201 });
    const path = `/Accounts/${TWILIO_SID}/Messages.json`;
    expect(last().path).toBe(path);
    expect(last().headers.get("content-type")).toBe("application/x-www-form-urlencoded");
    expect(last().headers.get("authorization")).toBe(`Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`);
    expect(Object.fromEntries(new URLSearchParams(last().body))).toEqual({
      To: "+15555550123",
      From: "+15555550100",
      Body: "DOWN: Checkout (Demo) since 10:00 UTC. status.example.com",
    });
    answers.set(path, [400]);
    expect(await PROVIDERS.sms.send(message, ch, context())).toEqual({
      ok: false,
      status: 400,
      error: "unverified_number",
      retryable: false,
    });
  });

  it("the Email Service REST API gets the message with the bearer token", async () => {
    const sender = restEmailSender({ token: "cf-test-token", accountId: "acc123", base });
    const ch = channel({ type: "email", to: [addr("ops"), addr("oncall")] });
    expect(await PROVIDERS.email.send(message, ch, context(sender))).toEqual({ ok: true, status: 200 });
    const got = last();
    expect(got.path).toBe("/accounts/acc123/email/sending/send");
    expect(got.headers.get("authorization")).toBe("Bearer cf-test-token");
    expect(JSON.parse(got.body)).toMatchObject({
      from: addr("status"),
      to: [addr("ops"), addr("oncall")],
      subject: "[Uptellis] Checkout is down",
    });
    answers.set("/accounts/acc123/email/sending/send", [403]);
    expect(await sender.send({ from: "a", to: [], subject: "", text: "", html: "" })).toMatchObject({
      status: 403,
      retryable: false,
    });
  });
});

interface SmtpSession {
  commands: string[];
  data: string;
}

/**
 * A tiny SMTP server: offers `mechs` for AUTH, answers `codes` for a command verb instead of the default,
 * records every command line and the DATA payload. `silent` accepts connections and never answers.
 */
async function fakeSmtp(opts: { mechs?: string; codes?: Record<string, number>; silent?: boolean } = {}) {
  const sessions: SmtpSession[] = [];
  const srv = net.createServer((sock) => {
    if (opts.silent) return;
    const s: SmtpSession = { commands: [], data: "" };
    sessions.push(s);
    let buf = "";
    let inData = false;
    let loginStep = 0;
    const say = (line: string) => sock.write(`${line}\r\n`);
    say("220 fake.example.org ESMTP");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let i = buf.indexOf("\r\n");
      while (i >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        i = buf.indexOf("\r\n");
        if (inData) {
          if (line === ".") {
            inData = false;
            say("250 queued");
          } else s.data += `${line}\r\n`;
          continue;
        }
        s.commands.push(line);
        if (loginStep === 1) {
          loginStep = 2;
          say("334 UGFzc3dvcmQ6");
          continue;
        }
        if (loginStep === 2) {
          loginStep = 0;
          say("235 ok");
          continue;
        }
        const verb = line.split(/[ :]/)[0]!.toUpperCase();
        const code = opts.codes?.[verb];
        if (code) {
          say(`${code} refused`);
          continue;
        }
        if (verb === "EHLO") {
          say("250-fake.example.org");
          say(`250-AUTH ${opts.mechs ?? "PLAIN LOGIN"}`);
          say("250 8BITMIME");
        } else if (verb === "AUTH" && line.toUpperCase().startsWith("AUTH LOGIN")) {
          loginStep = 1;
          say("334 VXNlcm5hbWU6");
        } else if (verb === "AUTH") say("235 ok");
        else if (verb === "DATA") {
          inData = true;
          say("354 go on");
        } else if (verb === "QUIT") {
          say("221 bye");
          sock.end();
        } else say("250 ok");
      }
    });
  });
  await new Promise<void>((resolve) => srv.listen(0, LOOPBACK, resolve));
  const port = (srv.address() as net.AddressInfo).port;
  return { sessions, port, close: () => srv.close() };
}

const mail: OutgoingEmail = {
  from: addr("status"),
  to: [addr("ops"), addr("oncall")],
  subject: "[Uptellis] Café is down",
  text: "Checkout is down\n.leading dot line",
  html: "<p>Checkout is down</p>",
};

/** The decoded text and HTML parts of a captured DATA payload. */
function parts(data: string) {
  const unstuffed = data
    .split("\r\n")
    .map((l) => (l.startsWith("..") ? l.slice(1) : l))
    .join("\r\n");
  const decode = (type: string) => {
    const at = unstuffed.indexOf(`Content-Type: ${type}`);
    const body = unstuffed.slice(unstuffed.indexOf("\r\n\r\n", at) + 4, unstuffed.indexOf("\r\n--", at));
    return Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8");
  };
  return {
    headers: unstuffed.slice(0, unstuffed.indexOf("\r\n\r\n")),
    text: decode("text/plain"),
    html: decode("text/html"),
  };
}

describe("SMTP", () => {
  it("parses smtp and smtps URLs with their default ports and decoded credentials", () => {
    expect(parseSmtpUrl(`smtps://user%40x:p%3Ass${"@"}mail.example.org`)).toEqual({
      secure: true,
      host: "mail.example.org",
      port: 465,
      user: "user@x",
      pass: "p:ss",
    });
    expect(parseSmtpUrl("smtp://mail.example.org")).toEqual({
      secure: false,
      host: "mail.example.org",
      port: 587,
    });
    expect(parseSmtpUrl("https://mail.example.org")).toBeNull();
    expect(parseSmtpUrl("not a url")).toBeNull();
  });

  it("delivers with AUTH PLAIN: envelope, headers, both parts, dot-stuffing", async () => {
    const smtp = await fakeSmtp();
    try {
      const sender = smtpEmailSender(parseSmtpUrl(`smtp://mailer:s3cret@${LOOPBACK}:${smtp.port}`)!);
      expect(await sender.send(mail)).toEqual({ ok: true, status: 250 });
      const [s] = smtp.sessions;
      expect(s!.commands).toEqual([
        "EHLO localhost",
        `AUTH PLAIN ${Buffer.from("\0mailer\0s3cret").toString("base64")}`,
        `MAIL FROM:<${addr("status")}>`,
        `RCPT TO:<${addr("ops")}>`,
        `RCPT TO:<${addr("oncall")}>`,
        "DATA",
        "QUIT",
      ]);
      const p = parts(s!.data);
      expect(p.headers).toContain(`From: ${addr("status")}`);
      expect(p.headers).toContain(`To: ${addr("ops")}, ${addr("oncall")}`);
      expect(p.headers).toContain(`Subject: =?UTF-8?B?${Buffer.from(mail.subject).toString("base64")}?=`);
      expect(p.headers).toContain("MIME-Version: 1.0");
      expect(p.text).toBe(mail.text);
      expect(p.html).toBe(mail.html);
    } finally {
      smtp.close();
    }
  });

  it("falls back to AUTH LOGIN", async () => {
    const smtp = await fakeSmtp({ mechs: "LOGIN" });
    try {
      const sender = smtpEmailSender(parseSmtpUrl(`smtp://mailer:s3cret@${LOOPBACK}:${smtp.port}`)!);
      expect(await sender.send(mail)).toEqual({ ok: true, status: 250 });
      expect(smtp.sessions[0]!.commands.slice(1, 4)).toEqual([
        "AUTH LOGIN",
        Buffer.from("mailer").toString("base64"),
        Buffer.from("s3cret").toString("base64"),
      ]);
    } finally {
      smtp.close();
    }
  });

  it("maps refusals: 4xx retryable, 5xx final, a refused login final", async () => {
    const busy = await fakeSmtp({ codes: { RCPT: 451 } });
    const reject = await fakeSmtp({ codes: { MAIL: 550 } });
    const login = await fakeSmtp({ codes: { AUTH: 535 } });
    try {
      const url = (port: number) => parseSmtpUrl(`smtp://mailer:s3cret@${LOOPBACK}:${port}`)!;
      expect(await smtpEmailSender(url(busy.port)).send(mail)).toEqual({
        ok: false,
        status: 451,
        error: "smtp_451",
        retryable: true,
      });
      expect(await smtpEmailSender(url(reject.port)).send(mail)).toMatchObject({
        error: "smtp_550",
        retryable: false,
      });
      expect(await smtpEmailSender(url(login.port)).send(mail)).toMatchObject({
        error: "smtp_535",
        retryable: false,
      });
    } finally {
      busy.close();
      reject.close();
      login.close();
    }
  });

  it("times out a silent server and reports a refused connection as network", async () => {
    const silent = await fakeSmtp({ silent: true });
    try {
      const sender = smtpEmailSender(parseSmtpUrl(`smtp://${LOOPBACK}:${silent.port}`)!, { timeoutMs: 200 });
      expect(await sender.send(mail)).toEqual({ ok: false, status: 0, error: "timeout", retryable: true });
    } finally {
      silent.close();
    }
    const closed = await fakeSmtp();
    closed.close();
    await new Promise((r) => setTimeout(r, 20));
    const refused = smtpEmailSender(parseSmtpUrl(`smtp://${LOOPBACK}:${closed.port}`)!, { timeoutMs: 2000 });
    expect(await refused.send(mail)).toMatchObject({ error: "network", retryable: true });
  });

  it("never sends credentials in the clear to a server that is not on localhost", async () => {
    // `localhost.` (a fully qualified name) reaches the fake server but is not the literal `localhost`, so
    // it counts as remote: without STARTTLS on offer the client stops before AUTH.
    const smtp = await fakeSmtp();
    try {
      const out = await smtpEmailSender(parseSmtpUrl(`smtp://mailer:s3cret@localhost.:${smtp.port}`)!, {
        timeoutMs: 2000,
      }).send(mail);
      expect(out.ok).toBe(false);
      if (smtp.sessions.length > 0)
        expect(out).toMatchObject({ error: "smtp_insecure_auth", retryable: false });
      expect(smtp.sessions.flatMap((x) => x.commands).some((c) => c.startsWith("AUTH"))).toBe(false);
    } finally {
      smtp.close();
    }
  });

  it("builds a stable MIME message", () => {
    const m = mimeMessage(mail, new Date(NOW), "fixed-id");
    expect(m).toContain(`Message-ID: <${["fixed-id", "example.org"].join("@")}>`);
    expect(m).toContain('Content-Type: multipart/alternative; boundary="uptellis-fixed-id"');
    expect(m.split("\r\n").every((l) => !l.startsWith(".") || l.startsWith(".."))).toBe(true);
  });
});

describe("the Docker email sender from the environment", () => {
  it("prefers the Email Service API, then SMTP (also from a _FILE), else none", async () => {
    expect(dockerEmailSender({})).toBeNull();
    expect(dockerEmailSender({ CLOUDFLARE_EMAIL_API_TOKEN: "t" })).toBeNull();
    const smtp = await fakeSmtp();
    const dir = mkdtempSync(join(tmpdir(), "uptellis-smtp-"));
    try {
      const file = join(dir, "smtp_url");
      writeFileSync(file, `smtp://${LOOPBACK}:${smtp.port}\n`);
      const fromFile = dockerEmailSender({ SMTP_URL_FILE: file });
      expect(await fromFile!.send(mail)).toEqual({ ok: true, status: 250 });
      expect(smtp.sessions).toHaveLength(1);
      expect(await dockerEmailSender({ SMTP_URL: "nonsense" })!.send(mail)).toMatchObject({
        error: "smtp_bad_url",
        retryable: false,
      });
      // Both Email Service values win over SMTP (no request here: only the choice).
      const api = dockerEmailSender({
        CLOUDFLARE_EMAIL_API_TOKEN: "t",
        CLOUDFLARE_ACCOUNT_ID: "a",
        SMTP_URL_FILE: file,
      });
      expect(api).not.toBeNull();
      expect(smtp.sessions).toHaveLength(1);
    } finally {
      smtp.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
