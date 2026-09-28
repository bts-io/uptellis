/** Fake `CheckTransport`s and monitors for the check library's unit tests: no network, a fixed clock. */
import { vi } from "vitest";
import type { CheckOptions, CheckTransport, TlsProbe } from "@/shared/monitors/check";
import { MonitorConfig, type MonitorConfigInput } from "@/shared/monitors/schema";

/** The check start every test uses: 2026-09-28T12:00:00.250Z (the result's `ts` drops the fraction). */
export const NOW = Date.parse("2026-09-28T12:00:00.250Z");
export const TS = "2026-09-28T12:00:00Z";
export const DAY_MS = 24 * 60 * 60 * 1000;

/** Parses a monitor; private hosts need an agent runner, so `office-1` runs them. */
export const monitor = (input: Record<string, unknown>) =>
  MonitorConfig.parse({ id: "m1", name: "Monitor", runners: ["office-1"], ...input } as MonitorConfigInput);

/** An error the way a transport rejects: `TimeoutError`, a Node refusal code, or a message naming the target. */
export function transportError(kind: "timeout" | "refused" | "other" | "refused-message"): Error {
  const err = new Error(
    kind === "refused-message" ? "connect: connection refused to db.example.org" : "failed on db.example.org",
  );
  if (kind === "timeout") err.name = "TimeoutError";
  if (kind === "refused") (err as Error & { code: string }).code = "ECONNREFUSED";
  return err;
}

/** A transport whose every primitive is a mock; tests override the ones they use. */
export function fakeTransport(over: Partial<CheckTransport> = {}): CheckTransport {
  return {
    fetch: vi.fn(async () => new Response("ok")) as unknown as typeof fetch,
    tcp: vi.fn(async () => ({ latencyMs: 12 })),
    ping: vi.fn(async () => 3.4),
    tls: vi.fn(async (): Promise<TlsProbe> => tlsProbe(30)),
    ...over,
  };
}

export function tlsProbe(days: number, authorized = true, cn: string | null = "example.org"): TlsProbe {
  const validToMs = NOW + days * DAY_MS + 60_000;
  return {
    latencyMs: 20,
    authorized,
    cert: {
      valid: authorized && days >= 0,
      cn,
      issuer: "Example CA",
      validTo: new Date(validToMs).toISOString(),
      daysRemaining: Math.floor((validToMs - NOW) / DAY_MS),
    },
  };
}

export const noWait = () => vi.fn(async (_ms: number) => {});

export const options = (transport: CheckTransport, over: Partial<CheckOptions> = {}): CheckOptions => ({
  transport,
  version: "0.3.0",
  sleep: noWait(),
  now: () => NOW,
  ...over,
});
