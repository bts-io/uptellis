/**
 * One attempt of a `tls` monitor: a TLS handshake with `host:port`, SNI `servername` (defaults to `host`),
 * reading the peer certificate. Down when the handshake fails (`timeout`, `connection refused`,
 * `connection failed`), the certificate has expired (`certificate expired`) or its chain is not valid for
 * the name (`certificate invalid`). Otherwise the days left decide: under `minDays` is `degraded`, else up,
 * both with the message `12 days left`. The certificate summary rides along whenever one was read.
 */
import type { CheckTransport } from "@/shared/monitors/check";
import type { MonitorConfig } from "@/shared/monitors/schema";
import { type Attempt, down, failureMessage } from "./attempt";

type Tls = Extract<MonitorConfig, { type: "tls" }>;

export const daysLeftMessage = (days: number) => (days === 1 ? "1 day left" : `${days} days left`);

export async function tlsAttempt(m: Tls, transport: CheckTransport, now: () => number): Promise<Attempt> {
  if (!transport.tls) return down("not supported");
  let probe: Awaited<ReturnType<NonNullable<CheckTransport["tls"]>>>;
  try {
    probe = await transport.tls(m.host, m.port, m.servername ?? m.host, m.timeoutS * 1000);
  } catch (err) {
    return down(failureMessage(err));
  }
  const latencyMs = Math.max(0, probe.latencyMs);
  const days = probe.cert.daysRemaining;
  const expired = days < 0 || Date.parse(probe.cert.validTo) <= now();
  const cert = { ...probe.cert, valid: probe.authorized && !expired };
  if (expired) return { status: "down", latencyMs, message: "certificate expired", cert };
  if (!probe.authorized) return { status: "down", latencyMs, message: "certificate invalid", cert };
  return { status: days < m.minDays ? "degraded" : "up", latencyMs, message: daysLeftMessage(days), cert };
}
