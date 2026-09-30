/**
 * SMS through Twilio: one short text (`smsText`) posted to the Messages resource of the channel's account
 * (`https://api.twilio.com/2010-04-01/Accounts/<sid>/Messages.json`) as a form, with HTTP Basic auth of
 * the Account SID and the auth token (the channel's secret), to the channel's one number, from its Twilio
 * number or Messaging Service. Plain fetch, no SDK, so it runs the same on Workers and in Docker.
 *
 * The numbers and the SID are personal or account data: they go into the request only, never into an
 * error, and Twilio's error `message` (which can echo the number) is never kept. A failure is named from
 * the status and Twilio's numeric `code` (`bad_token`, `invalid_number`, `unverified_number`,
 * `invalid_from`, `twilio_<code>`); a 429, 5xx or network error is retryable, the rest final.
 */
import type { AlertMessage, ChannelProvider } from "@/shared/notify";
import { duration, utc } from "../format";
import { postTo, refused, SECRET_MISSING } from "./http";

export const TWILIO_API = "https://api.twilio.com/2010-04-01";

/** One SMS segment in the GSM-7 alphabet. */
export const SMS_MAX = 160;

/** A Twilio auth token: 32 hex characters. */
const AUTH_TOKEN = /^[0-9a-f]{32}$/i;

/** Twilio error codes worth a name of their own in the delivery log; any other code is `twilio_<code>`. */
export const TWILIO_ERRORS: Readonly<Record<number, string>> = {
  20003: "bad_token",
  21211: "invalid_number",
  21614: "invalid_number",
  21608: "unverified_number",
  21212: "invalid_from",
  21606: "invalid_from",
  21659: "invalid_from",
  21660: "invalid_from",
  21610: "opted_out",
  21408: "region_disabled",
};

/**
 * ASCII characters that are not in the GSM-7 basic set (the extension table costs two characters each, or
 * the character does not exist there), with what they become; typographic marks map to their ASCII kin.
 */
const GSM_REPLACE: Readonly<Record<string, string>> = {
  "[": "(",
  "]": ")",
  "{": "(",
  "}": ")",
  "\\": "/",
  "|": "/",
  "~": "-",
  "^": "",
  "`": "'",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2026": "...",
};

/**
 * `s` as plain ASCII inside the GSM-7 basic set: accents dropped (`Zürich` becomes `Zurich`), whitespace
 * runs as one space, the marks above replaced, and any other character as `?`.
 */
export function gsmSafe(s: string): string {
  let out = "";
  for (const ch of s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")) {
    const mapped = GSM_REPLACE[ch];
    if (mapped !== undefined) out += mapped;
    else out += /[\x20-\x7e]/.test(ch) ? ch : "?";
  }
  return out.trim();
}

/** `s` cut to at most `max` characters, ending in `...` when cut. */
const clip = (s: string, max: number) => {
  if (s.length <= max) return s;
  if (max <= 3) return ".".repeat(Math.max(0, max));
  return `${s.slice(0, max - 3).trimEnd()}...`;
};

/** `a` and `b` cut to share `room` characters, the shorter keeping its length when it fits in half. */
function share(a: string, b: string, room: number): [string, string] {
  if (a.length + b.length <= room) return [a, b];
  const half = Math.floor(room / 2);
  if (a.length <= half) return [a, clip(b, room - a.length)];
  if (b.length <= half) return [clip(a, room - b.length), b];
  return [clip(a, half), clip(b, room - half)];
}

/** The status page without its scheme and trailing slash: `status.example.com`, `example.com/status`. */
export function smsLink(pageUrl: string | null): string | null {
  if (!pageUrl) return null;
  try {
    const u = new URL(pageUrl);
    return `${u.host}${u.pathname}${u.search}`.replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** `14:02 UTC` on the day the message is sent, else `2026-09-27 14:02 UTC`. */
function since(m: AlertMessage): string {
  const start = Date.parse(m.startedAt);
  const sameDay =
    new Date(start).toISOString().slice(0, 10) === new Date(m.sentAt).toISOString().slice(0, 10);
  return sameDay ? utc(start).slice(11) : utc(start);
}

/**
 * The text of an alert, at most `SMS_MAX` GSM-7 characters of plain ASCII (no emoji), `TEST ` first on a
 * test. The service (or source) and site names are cut with `...` to fit; the link never is:
 *
 * - `DOWN: Checkout (Acme Cloud) since 14:02 UTC. status.example.com`
 * - `UP: Checkout (Acme Cloud) is back after 12 min. status.example.com`
 * - `STALE: source kuma:watch-1 (Acme Cloud) silent since 14:02 UTC.`
 * - `RECOVERED: source kuma:watch-1 (Acme Cloud) is reporting again.`
 */
export function smsText(m: AlertMessage): string {
  const s = m.subject;
  const subject = gsmSafe(s.kind === "service" ? s.name : s.id);
  const site = gsmSafe(m.site.name);
  const link = smsLink(m.pageUrl);
  const back =
    m.durationS === null
      ? "is back up"
      : m.durationS < 60
        ? "is back within a minute"
        : `is back after ${duration(m.durationS * 1000)}`;
  const line = (a: string, b: string) => {
    const body = {
      down: `DOWN: ${a} (${b}) since ${since(m)}.`,
      up: `UP: ${a} (${b}) ${back}.`,
      stale: `STALE: source ${a} (${b}) silent since ${since(m)}.`,
      recovered: `RECOVERED: source ${a} (${b}) is reporting again.`,
    }[m.event];
    return `${m.test ? "TEST " : ""}${body}${link ? ` ${link}` : ""}`;
  };
  const [a, b] = share(subject, site, SMS_MAX - line("", "").length);
  return line(a, b);
}

/** A short code for a failed send from its status and Twilio's JSON error body; never its message. */
export function twilioError(status: number, data: unknown): string | undefined {
  if (status === 429 || status >= 500) return undefined;
  const raw = data !== null && typeof data === "object" ? (data as { code?: unknown }).code : undefined;
  const code = typeof raw === "string" && /^\d{5}$/.test(raw) ? Number(raw) : raw;
  if (typeof code === "number" && Number.isInteger(code) && code >= 10000 && code <= 99999) {
    const named = TWILIO_ERRORS[code];
    if (named) return named;
    if (status !== 401 && status !== 403) return `twilio_${code}`;
  }
  if (status === 401 || status === 403) return "bad_token";
  return undefined;
}

export const smsProvider: ChannelProvider<"sms"> = {
  type: "sms",
  async send(message, channel, ctx) {
    const token = ctx.secret(channel.secret);
    if (!token) return SECRET_MISSING;
    if (!AUTH_TOKEN.test(token)) return refused("bad_token");
    const form = new URLSearchParams({ To: channel.to, Body: smsText(message) });
    form.set(channel.from.startsWith("MG") ? "MessagingServiceSid" : "From", channel.from);
    return postTo(
      ctx.fetch,
      `${TWILIO_API}/Accounts/${channel.accountSid}/Messages.json`,
      {
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${btoa(`${channel.accountSid}:${token}`)}`,
        },
        body: form.toString(),
      },
      twilioError,
    );
  },
};
