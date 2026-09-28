// The one place the agent picks its check library: `runCheck` and the Bun transport (fetch, node:net,
// node:tls, the system `ping`) from src/checks, bundled into the binary. Everything else takes a `RunCheck`
// and a `CheckTransport` by injection, so tests pass fakes.
//
// TODO(p6-integration): import src/checks. Replace the stub below with:
//   export { runCheck as defaultRunCheck } from "../../src/checks/index.ts";
//   export { bunTransport as defaultTransport } from "../../src/checks/bun-transport.ts";
// (whatever the checkers stream names the transport export). The image already copies src/checks
// (Dockerfile.dockerignore).
import type { CheckResult, CheckTransport, MonitorConfig, RunCheck } from "./shared";

const unsupported = (): Promise<never> => Promise.reject(new Error("not supported"));

/** Stub until src/checks lands: no network access at all. */
export const defaultTransport: CheckTransport = {
  fetch: unsupported as unknown as typeof fetch,
  tcp: unsupported,
};

/** Stub until src/checks lands: every check is `down` with `not supported`, never throwing. */
export const defaultRunCheck: RunCheck = async (monitor: MonitorConfig, options): Promise<CheckResult> => {
  const now = options.now?.() ?? Date.now();
  return {
    monitorId: monitor.id,
    ts: new Date(Math.floor(now / 1000) * 1000).toISOString(),
    status: "down",
    latencyMs: null,
    message: "not supported",
  };
};
