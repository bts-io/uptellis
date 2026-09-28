/**
 * What one attempt of a check yields, before `runCheck` stamps it with the monitor id and start time, and
 * the one place transport errors become display text. Transports reject with raw errors whose messages may
 * carry the target's address, so no error message is ever passed through: an error maps to one of three
 * fixed words (`timeout`, `connection refused`, `connection failed`).
 */

import type { CertSummary } from "@/shared/model/service";
import type { CheckStatus } from "@/shared/monitors/api";

export interface Attempt {
  status: CheckStatus;
  /** Time to the response, connection or echo; null when nothing answered. */
  latencyMs: number | null;
  message: string;
  cert?: CertSummary;
}

export const down = (message: string, latencyMs: number | null = null): Attempt => ({
  status: "down",
  latencyMs,
  message,
});

/** Error codes (Node, Bun `fetch`) meaning the port answered with a reset: nothing listens there. */
const REFUSED_CODES = new Set(["ECONNREFUSED", "ConnectionRefused"]);

/** A transport error as a short display-safe message; the error's own text is never shown. */
export function failureMessage(err: unknown): string {
  if (!(err instanceof Error)) return "connection failed";
  if (err.name === "TimeoutError") return "timeout";
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string" && REFUSED_CODES.has(code)) return "connection refused";
  // Workers' sockets report a refusal only in the message.
  if (/connection refused/i.test(err.message)) return "connection refused";
  return "connection failed";
}

/** An Error named `TimeoutError`, as `AbortSignal.timeout` raises it; transports reject with it on timeout. */
export function timeoutError(): Error {
  const err = new Error("timed out");
  err.name = "TimeoutError";
  return err;
}
