/**
 * One attempt of a `tcp` monitor: open a connection to `host:port` within the timeout and close it again.
 * Nothing is sent. Up (`connected`) once the connection opens; a reset is `connection refused`, anything
 * else `timeout` or `connection failed`. Latency is the time to the open connection, as the transport
 * measures it.
 */
import type { CheckTransport } from "../shared/monitors/check";
import type { MonitorConfig } from "../shared/monitors/schema";
import { type Attempt, down, failureMessage } from "./attempt";

type Tcp = Extract<MonitorConfig, { type: "tcp" }>;

export async function tcpAttempt(m: Tcp, transport: CheckTransport): Promise<Attempt> {
  try {
    const { latencyMs } = await transport.tcp(m.host, m.port, m.timeoutS * 1000);
    return { status: "up", latencyMs: Math.max(0, latencyMs), message: "connected" };
  } catch (err) {
    return down(failureMessage(err));
  }
}
