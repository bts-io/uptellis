/**
 * A minimal SMTP client for the Docker email sender (`SMTP_URL`), over `node:net` and `node:tls` with no
 * dependency. `smtps://` speaks TLS from the first byte (port 465 by default); `smtp://` (port 587 by
 * default) upgrades with STARTTLS whenever the server offers it. Credentials in the URL are sent with
 * AUTH PLAIN, else AUTH LOGIN, and only over TLS (or to a server on localhost). One connection per
 * message: EHLO, MAIL FROM, RCPT TO for each address, DATA with a multipart/alternative body (text and
 * HTML, base64), QUIT.
 *
 * Outcomes: a 4xx reply or a dropped connection is retryable, a 5xx reply is final (`smtp_535` is a
 * refused login), the whole session times out after `SMTP_TIMEOUT_MS`. No reply text, address or
 * credential is ever returned or logged.
 */
import { randomUUID } from "node:crypto";
import net from "node:net";
import tls from "node:tls";
import type { DeliveryOutcome, EmailSender, OutgoingEmail } from "@/shared/notify";

export const SMTP_TIMEOUT_MS = 20_000;

export interface SmtpConfig {
  /** Implicit TLS (`smtps://`). */
  secure: boolean;
  host: string;
  port: number;
  user?: string;
  pass?: string;
}

/** `smtp[s]://[user:pass@]host[:port]`, credentials percent-decoded; null for anything else. */
export function parseSmtpUrl(raw: string): SmtpConfig | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "smtp:" && url.protocol !== "smtps:") return null;
  if (!url.hostname) return null;
  const secure = url.protocol === "smtps:";
  const port = url.port ? Number(url.port) : secure ? 465 : 587;
  const user = url.username ? decodeURIComponent(url.username) : undefined;
  const pass = url.password ? decodeURIComponent(url.password) : undefined;
  return {
    secure,
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port,
    ...(user ? { user } : {}),
    ...(pass ? { pass } : {}),
  };
}

/** A reply failed the step: `code` is the SMTP code (0 when the connection failed). */
class SmtpError extends Error {
  constructor(
    readonly code: number,
    readonly kind: "reply" | "network" | "timeout" | "insecure_auth" | "no_auth",
  ) {
    super(kind);
    this.name = "SmtpError";
  }
}

interface Reply {
  code: number;
  lines: string[];
}

/** Reads CRLF lines from a socket and groups them into replies (the last line has a space after the code). */
function replyReader(socket: net.Socket) {
  let buf = "";
  const lines: string[] = [];
  let failed: SmtpError | null = null;
  let wake: (() => void) | null = null;
  const poke = () => {
    const w = wake;
    wake = null;
    w?.();
  };
  const onData = (d: Buffer | string) => {
    buf += typeof d === "string" ? d : d.toString("utf8");
    let i = buf.indexOf("\n");
    while (i >= 0) {
      lines.push(buf.slice(0, i).replace(/\r$/, ""));
      buf = buf.slice(i + 1);
      i = buf.indexOf("\n");
    }
    poke();
  };
  const onClose = () => {
    failed ??= new SmtpError(0, "network");
    poke();
  };
  const onError = () => onClose();
  socket.on("data", onData);
  socket.on("close", onClose);
  socket.on("error", onError);
  return {
    async reply(): Promise<Reply> {
      const out: string[] = [];
      for (;;) {
        while (lines.length === 0) {
          if (failed) throw failed;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        const line = lines.shift()!;
        out.push(line);
        if (/^\d{3}(?: |$)/.test(line)) return { code: Number(line.slice(0, 3)), lines: out };
        if (!/^\d{3}-/.test(line)) throw new SmtpError(0, "network");
      }
    },
    fail(err: SmtpError) {
      failed ??= err;
      poke();
    },
    detach() {
      socket.off("data", onData);
      socket.off("close", onClose);
      socket.off("error", onError);
    },
  };
}

/** Waits for a socket's connect (plain) or secureConnect (TLS) event. */
function connected(socket: net.Socket, event: "connect" | "secureConnect"): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once(event, () => resolve());
    socket.once("error", () => reject(new SmtpError(0, "network")));
    socket.once("close", () => reject(new SmtpError(0, "network")));
  });
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
/** Base64 in lines of 76 characters (RFC 2045). */
const b64Lines = (s: string) => b64(s).replace(/.{76}/g, "$&\r\n");
/** A header value: no line breaks; RFC 2047 encoded when not plain ASCII. */
const headerValue = (s: string) => {
  const flat = s.replace(/[\r\n]+/g, " ");
  return /^[\x20-\x7e]*$/.test(flat) ? flat : `=?UTF-8?B?${b64(flat)}?=`;
};

/** The DATA payload: headers, a multipart/alternative body, dot-stuffed, CRLF line ends. */
export function mimeMessage(message: OutgoingEmail, date: Date, id: string = randomUUID()): string {
  const boundary = `uptellis-${id}`;
  const domain = message.from.slice(message.from.lastIndexOf("@") + 1) || "localhost";
  const lines = [
    `From: ${message.from}`,
    `To: ${message.to.join(", ")}`,
    `Subject: ${headerValue(message.subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${id}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(message.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(message.html),
    `--${boundary}--`,
  ];
  return lines
    .join("\r\n")
    .split("\r\n")
    .map((l) => (l.startsWith(".") ? `.${l}` : l))
    .join("\r\n");
}

const isLocal = (host: string) => host === "localhost" || /^127\.\d+\.\d+\.\d+$/.test(host);

/** One SMTP session delivering `message`; throws `SmtpError`. */
async function session(config: SmtpConfig, message: OutgoingEmail, timeoutMs: number): Promise<void> {
  let socket: net.Socket = config.secure
    ? tls.connect({ host: config.host, port: config.port, servername: config.host })
    : net.connect({ host: config.host, port: config.port });
  let secure = config.secure;
  let reader = replyReader(socket);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    reader.fail(new SmtpError(0, "timeout"));
    socket.destroy();
  }, timeoutMs);
  try {
    await connected(socket, config.secure ? "secureConnect" : "connect");
    const send = async (line: string, ...ok: number[]): Promise<Reply> => {
      socket.write(`${line}\r\n`);
      return expect(await reader.reply(), ...ok);
    };
    const expect = (reply: Reply, ...ok: number[]) => {
      if (!ok.includes(reply.code)) throw new SmtpError(reply.code, "reply");
      return reply;
    };
    expect(await reader.reply(), 220);
    let ehlo = await send("EHLO localhost", 250);
    const offers = (r: Reply, ext: string) =>
      r.lines.some((l) => l.slice(4).toUpperCase().split(/\s+/)[0] === ext);
    if (!secure && offers(ehlo, "STARTTLS")) {
      await send("STARTTLS", 220);
      reader.detach();
      const upgraded = tls.connect({ socket, servername: config.host });
      await connected(upgraded, "secureConnect");
      socket = upgraded;
      secure = true;
      reader = replyReader(socket);
      ehlo = await send("EHLO localhost", 250);
    }
    if (config.user) {
      if (!secure && !isLocal(config.host)) throw new SmtpError(0, "insecure_auth");
      const mechs = ehlo.lines
        .map((l) => l.slice(4).toUpperCase().split(/\s+/))
        .find((w) => w[0] === "AUTH" || w[0] === "AUTH=")
        ?.slice(1);
      const user = config.user;
      const pass = config.pass ?? "";
      if (mechs?.includes("PLAIN")) {
        await send(`AUTH PLAIN ${b64(`\0${user}\0${pass}`)}`, 235);
      } else if (mechs?.includes("LOGIN")) {
        await send("AUTH LOGIN", 334);
        await send(b64(user), 334);
        await send(b64(pass), 235);
      } else {
        throw new SmtpError(0, "no_auth");
      }
    }
    await send(`MAIL FROM:<${message.from}>`, 250);
    for (const to of message.to) await send(`RCPT TO:<${to}>`, 250, 251);
    await send("DATA", 354);
    socket.write(`${mimeMessage(message, new Date())}\r\n.\r\n`);
    expect(await reader.reply(), 250);
    // Delivered; a polite QUIT whose answer does not matter.
    socket.write("QUIT\r\n");
    await reader.reply().catch(() => undefined);
  } catch (err) {
    throw timedOut ? new SmtpError(0, "timeout") : err;
  } finally {
    clearTimeout(timer);
    reader.detach();
    socket.end();
  }
}

function outcomeOf(err: unknown): DeliveryOutcome {
  if (!(err instanceof SmtpError)) return { ok: false, status: 0, error: "smtp_error", retryable: true };
  switch (err.kind) {
    case "reply":
      return { ok: false, status: err.code, error: `smtp_${err.code}`, retryable: err.code < 500 };
    case "timeout":
      return { ok: false, status: 0, error: "timeout", retryable: true };
    case "network":
      return { ok: false, status: 0, error: "network", retryable: true };
    default:
      return { ok: false, status: 0, error: `smtp_${err.kind}`, retryable: false };
  }
}

export function smtpEmailSender(config: SmtpConfig, opts: { timeoutMs?: number } = {}): EmailSender {
  return {
    async send(message) {
      try {
        await session(config, message, opts.timeoutMs ?? SMTP_TIMEOUT_MS);
        return { ok: true, status: 250 };
      } catch (err) {
        return outcomeOf(err);
      }
    },
  };
}
