/**
 * The check library every runner shares (contract: src/shared/monitors/check.ts). `runCheck` performs one
 * check of a monitor over the runtime's `CheckTransport` and never throws: every failure is a `down`
 * result with a short display-safe message, never the target's host or address.
 *
 * An attempt that is not `up` is retried once after `RETRY_DELAY_MS` and the second attempt is the result,
 * so a blip is never reported (`retries` in the config counts whole checks and belongs to confirmation).
 * `ts` is the start of the check in whole seconds UTC. A monitor type the transport cannot run (`ping`,
 * `tls` on Workers) is `down` with `not supported`; runners skip those types before calling.
 *
 * This module is runtime-neutral (Workers, Bun). The Bun transport is in ./bun-transport.ts and the
 * Workers one in src/platform/cloudflare/check-transport.ts; neither is imported here.
 */
import { ShortMessage } from "../shared/model/common";
import { CertSummary } from "../shared/model/service";
import type { CheckResult } from "../shared/monitors/api";
import { type CheckOptions, RETRY_DELAY_MS, type RunCheck } from "../shared/monitors/check";
import type { MonitorConfig } from "../shared/monitors/schema";
import { type Attempt, down } from "./attempt";
import { httpAttempt } from "./http";
import { pingAttempt } from "./ping";
import { tcpAttempt } from "./tcp";
import { tlsAttempt } from "./tls";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `2026-09-28T12:00:00Z`: whole seconds, UTC. */
export const isoSeconds = (ms: number) =>
  new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");

async function attempt(m: MonitorConfig, options: CheckOptions, now: () => number): Promise<Attempt> {
  const { transport } = options;
  try {
    switch (m.type) {
      case "http":
        return await httpAttempt(m, { fetch: transport.fetch, version: options.version, now });
      case "tcp":
        return await tcpAttempt(m, transport);
      case "ping":
        return await pingAttempt(m, transport);
      case "tls":
        return await tlsAttempt(m, transport, now);
      case "push":
        // Nothing checks a push monitor (it is not in any runner's `RUNNER_TYPES`).
        return down("not supported");
    }
  } catch {
    // Each attempt already maps transport errors; this only guards against a misbehaving transport.
  }
  return down("check failed");
}

/** A certificate summary the model accepts: a CN or issuer that is not display-safe (an address) is dropped. */
function safeCert(cert: Attempt["cert"]): CheckResult["cert"] {
  if (!cert) return undefined;
  const shown = {
    ...cert,
    cn: cert.cn && CertSummary.shape.cn.safeParse(cert.cn).success ? cert.cn : null,
    issuer: cert.issuer && CertSummary.shape.issuer.safeParse(cert.issuer).success ? cert.issuer : null,
  };
  return CertSummary.safeParse(shown).success ? shown : undefined;
}

function toResult(m: MonitorConfig, ts: string, a: Attempt): CheckResult {
  const cert = safeCert(a.cert);
  return {
    monitorId: m.id,
    ts,
    status: a.status,
    latencyMs: a.latencyMs === null || !Number.isFinite(a.latencyMs) ? null : Math.round(a.latencyMs),
    message: ShortMessage.safeParse(a.message).success ? a.message : "check failed",
    ...(cert ? { cert } : {}),
  };
}

export const runCheck: RunCheck = async (monitor, options) => {
  const now = options.now ?? Date.now;
  const ts = isoSeconds(now());
  const first = await attempt(monitor, options, now);
  if (first.status === "up") return toResult(monitor, ts, first);
  try {
    await (options.sleep ?? wait)(RETRY_DELAY_MS);
  } catch {
    // A failing sleep only shortens the pause.
  }
  return toResult(monitor, ts, await attempt(monitor, options, now));
};

export { daysLeftMessage } from "./tls";
