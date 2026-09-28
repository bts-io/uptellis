/**
 * TODO(p6-integration): switch to src/checks. A stand-in for the checkers stream's `runCheck` and
 * transports so the builtin runner works before they land: `http` monitors without a keyword run through
 * the existing edge checker (src/worker/probes/checker.ts: one fetch, redirects never followed, one retry
 * after 2 s), every other monitor is reported `down` with "not supported". The lead replaces
 * `legacyRunCheck` with `runCheck` from src/checks and `legacyTransport` with the runtime's transport
 * (src/platform/cloudflare/check-transport.ts, src/checks/bun-transport.ts), then deletes this file and
 * src/worker/probes/.
 */
import type { ProbeConfig } from "@/shared/config";
import type { CheckTransport, RunCheck } from "@/shared/monitors";
import { isoSeconds } from "../adapters/common";
import { checkProbe } from "../probes/checker";

/** `fetch` only; the other primitives refuse (the legacy checker never calls them). */
export const legacyTransport: CheckTransport = {
  // Looked up per call, so a test that replaces the global fetch is seen.
  fetch: ((input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, init)) as typeof fetch,
  tcp: async () => {
    throw new Error("not supported");
  },
};

export const legacyRunCheck: RunCheck = async (monitor, options) => {
  const started = options.now?.() ?? Date.now();
  const ts = isoSeconds(Math.floor(started / 1000) * 1000);
  if (monitor.type !== "http" || monitor.keyword) {
    return { monitorId: monitor.id, ts, status: "down", latencyMs: null, message: "not supported" };
  }
  const probe = {
    id: monitor.id,
    name: monitor.name,
    url: monitor.url,
    method: monitor.method,
    expectStatus: monitor.expectStatus,
    timeoutS: monitor.timeoutS,
    intervalS: monitor.intervalS,
  } satisfies ProbeConfig;
  const r = await checkProbe(probe, { fetch: options.transport.fetch, sleep: options.sleep });
  return { monitorId: monitor.id, ts, status: r.status, latencyMs: r.latencyMs, message: r.message };
};
