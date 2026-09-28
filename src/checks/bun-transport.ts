/**
 * The `CheckTransport` for Bun (the Docker server and uptellis-agent): all four monitor types.
 *
 * - `fetch`: the global fetch.
 * - `tcp`: a `node:net` connection, resolved on `connect` and destroyed at once.
 * - `tls`: a `node:tls` connection with SNI, never rejected for its certificate so the certificate can be
 *   read; `authorized` says whether the chain was valid for the name. CN, issuer (organisation, else CN),
 *   expiry and whole days left go into the `CertSummary`.
 * - `ping`: the system `ping` binary (`ping -c 1 -W <s> -- <host>`), spawned with an argument array and
 *   never through a shell; the round trip is parsed from its output. A host starting with `-` is refused
 *   (the monitor schema already limits hosts to names and addresses).
 *
 * Every primitive rejects on failure, with an Error named `TimeoutError` when the timeout ran out. Error
 * messages may name the target; runCheck never shows them.
 */
import { execFile } from "node:child_process";
import net from "node:net";
import tls from "node:tls";
import type { CertSummary } from "@/shared/model/service";
import type { CheckTransport, TcpProbe, TlsProbe } from "@/shared/monitors/check";
import { timeoutError } from "./attempt";

export interface BunTransportOptions {
  /** Extra trusted CA certificates (PEM) for `tls`, on top of the system store. Tests use a local CA. */
  tlsCa?: string[];
  /** The ping binary; `ping` on PATH by default. */
  pingPath?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A bracketed IPv6 host as written in a URL loses its brackets for the socket APIs. */
const bare = (host: string) => host.replace(/^\[|\]$/g, "");

/**
 * Runs `open` (which starts a socket and returns it) and settles on `ready` or `error`, with a timeout.
 * The socket is always destroyed afterwards.
 */
function withSocket<T>(
  timeoutMs: number,
  open: () => net.Socket,
  readyEvent: string,
  onReady: (socket: net.Socket) => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let socket: net.Socket | undefined;
    const done = (fn: () => void) => {
      clearTimeout(timer);
      socket?.destroy();
      fn();
    };
    const timer = setTimeout(() => done(() => reject(timeoutError())), timeoutMs);
    try {
      socket = open();
    } catch (err) {
      done(() => reject(err));
      return;
    }
    socket.once(readyEvent, () => {
      let value: T;
      try {
        value = onReady(socket!);
      } catch (err) {
        done(() => reject(err));
        return;
      }
      done(() => resolve(value));
    });
    socket.once("error", (err) => done(() => reject(err)));
  });
}

/** First value of a certificate name field (`subject.CN` may be an array when repeated). */
function field(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s.slice(0, 200) : null;
}

export function certSummary(peer: tls.PeerCertificate, authorized: boolean, nowMs: number): CertSummary {
  const validToMs = Date.parse(peer.valid_to);
  if (!Number.isFinite(validToMs)) throw new Error("certificate without an expiry");
  const daysRemaining = Math.floor((validToMs - nowMs) / DAY_MS);
  return {
    valid: authorized && validToMs > nowMs,
    cn: field(peer.subject?.CN),
    issuer: field(peer.issuer?.O) ?? field(peer.issuer?.CN),
    validTo: new Date(validToMs).toISOString(),
    daysRemaining,
  };
}

/** Parses the round trip from `ping` output: the `time=0.123 ms` of the reply, else the rtt summary line. */
export function parsePingRtt(output: string): number | null {
  const reply = /time[=<]\s*([\d.]+)\s*ms/.exec(output);
  if (reply) return Number(reply[1]);
  const summary = /=\s*[\d.]+\/([\d.]+)\/[\d.]+/.exec(output);
  return summary ? Number(summary[1]) : null;
}

export function createBunTransport(options: BunTransportOptions = {}): CheckTransport {
  const ca = options.tlsCa?.length ? [...tls.rootCertificates, ...options.tlsCa] : undefined;
  return {
    // Called through the transport object, so wrapped to keep the global `this`; Bun's `preconnect` is unused.
    fetch: ((input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, init)) as typeof fetch,

    tcp(host, port, timeoutMs): Promise<TcpProbe> {
      const started = performance.now();
      return withSocket(
        timeoutMs,
        () => net.connect({ host: bare(host), port }),
        "connect",
        () => ({ latencyMs: performance.now() - started }),
      );
    },

    tls(host, port, servername, timeoutMs): Promise<TlsProbe> {
      const started = performance.now();
      return withSocket(
        timeoutMs,
        () =>
          tls.connect({
            host: bare(host),
            port,
            // SNI must be a name; for an address with no servername none is sent.
            servername: net.isIP(bare(servername)) ? undefined : servername,
            rejectUnauthorized: false,
            ca,
          }),
        "secureConnect",
        (socket) => {
          const s = socket as tls.TLSSocket;
          const latencyMs = performance.now() - started;
          const peer = s.getPeerCertificate();
          if (!peer?.valid_to) throw new Error("no peer certificate");
          return { latencyMs, authorized: s.authorized, cert: certSummary(peer, s.authorized, Date.now()) };
        },
      );
    },

    ping(host, timeoutMs): Promise<number> {
      const target = bare(host);
      if (!target || target.startsWith("-")) return Promise.reject(new Error("invalid host"));
      const waitS = String(Math.max(1, Math.ceil(timeoutMs / 1000)));
      return new Promise<number>((resolve, reject) => {
        execFile(
          options.pingPath ?? "ping",
          ["-c", "1", "-W", waitS, "--", target],
          // A grace second past ping's own wait, then the process is killed.
          { timeout: timeoutMs + 1000, windowsHide: true, env: { ...process.env, LC_ALL: "C" } },
          (err, stdout) => {
            if (err) {
              // Killed past the grace second, or ran but got no echo back within its wait: a timeout.
              const killed = (err as { killed?: boolean }).killed;
              const noReply = /\b0 (?:packets )?received\b/.test(String(stdout));
              reject(killed || noReply ? timeoutError() : new Error("ping failed"));
              return;
            }
            const rtt = parsePingRtt(String(stdout));
            if (rtt === null) reject(new Error("ping failed"));
            else resolve(rtt);
          },
        );
      });
    },
  };
}
