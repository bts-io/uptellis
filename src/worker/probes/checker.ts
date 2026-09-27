/**
 * One HTTP check of a configured probe from Cloudflare's edge: a plain
 * `fetch` of the configured https URL with a timeout, no edge cache and redirects never followed, so a
 * check can only ever reach the URL in the site config. A status inside `expectStatus` is `up`; anything
 * else is retried once after 2 s before it counts as `down`. The body is never read.
 */
import type { ProbeConfig } from "@/shared/config";

export interface ProbeResult {
  status: "up" | "down";
  /** Time to the response headers; null when no response arrived. */
  latencyMs: number | null;
  /** Short and display-safe: `HTTP 200`, `HTTP 503`, `timeout` or `connection failed`. */
  message: string;
}

export interface CheckOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export const RETRY_DELAY_MS = 2000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function checkOnce(probe: ProbeConfig, fetchFn: typeof fetch): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const res = await fetchFn(probe.url, {
      method: probe.method,
      redirect: "manual",
      signal: AbortSignal.timeout(probe.timeoutS * 1000),
      headers: { "user-agent": "uptellis-probe" },
      cf: { cacheTtl: 0 },
    } as RequestInit);
    const latencyMs = Date.now() - started;
    await res.body?.cancel();
    const { min, max } = probe.expectStatus;
    const up = res.status >= min && res.status <= max;
    return { status: up ? "up" : "down", latencyMs, message: `HTTP ${res.status}` };
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    return { status: "down", latencyMs: null, message: timedOut ? "timeout" : "connection failed" };
  }
}

/** Runs the check, and once more after `RETRY_DELAY_MS` when the first attempt is not up. */
export async function checkProbe(probe: ProbeConfig, options: CheckOptions = {}): Promise<ProbeResult> {
  const fetchFn = options.fetch ?? fetch;
  const first = await checkOnce(probe, fetchFn);
  if (first.status === "up") return first;
  await (options.sleep ?? wait)(RETRY_DELAY_MS);
  return checkOnce(probe, fetchFn);
}
