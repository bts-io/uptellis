/**
 * One attempt of a `ping` monitor: one ICMP echo within the timeout. Up (`reply`) with the round trip as
 * latency; no reply is `timeout` when the transport says so and `ping failed` otherwise (unreachable,
 * unknown name, no ICMP permission). Only runtimes whose transport has `ping` run these monitors; a
 * transport without it answers `not supported` rather than throwing.
 */
import type { CheckTransport } from "../shared/monitors/check";
import type { MonitorConfig } from "../shared/monitors/schema";
import { type Attempt, down } from "./attempt";

type Ping = Extract<MonitorConfig, { type: "ping" }>;

export async function pingAttempt(m: Ping, transport: CheckTransport): Promise<Attempt> {
  if (!transport.ping) return down("not supported");
  try {
    const rtt = await transport.ping(m.host, m.timeoutS * 1000);
    return { status: "up", latencyMs: Math.max(0, rtt), message: "reply" };
  } catch (err) {
    return down(err instanceof Error && err.name === "TimeoutError" ? "timeout" : "ping failed");
  }
}
