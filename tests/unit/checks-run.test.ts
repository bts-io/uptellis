import { describe, expect, it, vi } from "vitest";
import { isoSeconds, runCheck } from "@/checks";
import { CheckResult } from "@/shared/monitors/api";
import { RETRY_DELAY_MS } from "@/shared/monitors/check";
import {
  fakeTransport,
  monitor,
  NOW,
  noWait,
  options,
  TS,
  tlsProbe,
  transportError,
} from "../support/fake-check-transport";

// The shared behaviour of runCheck: the one quick retry, the start time, never throwing, display safety.
describe("runCheck", () => {
  it("stamps the monitor id and the start of the check in whole seconds UTC", async () => {
    const r = await runCheck(
      monitor({ type: "tcp", host: "db.example.org", port: 5432 }),
      options(fakeTransport()),
    );
    expect(r).toEqual({ monitorId: "m1", ts: TS, status: "up", latencyMs: 12, message: "connected" });
    expect(CheckResult.safeParse(r).success).toBe(true);
    expect(isoSeconds(NOW)).toBe("2026-09-28T12:00:00Z");
  });

  it("does not retry an up attempt", async () => {
    const transport = fakeTransport();
    const sleep = noWait();
    await runCheck(
      monitor({ type: "tcp", host: "db.example.org", port: 5432 }),
      options(transport, { sleep }),
    );
    expect(transport.tcp).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a failing attempt once after RETRY_DELAY_MS and reports the second attempt", async () => {
    const tcp = vi
      .fn()
      .mockRejectedValueOnce(transportError("refused"))
      .mockResolvedValueOnce({ latencyMs: 7 });
    const sleep = noWait();
    const r = await runCheck(
      monitor({ type: "tcp", host: "db.example.org", port: 5432 }),
      options(fakeTransport({ tcp }), { sleep }),
    );
    expect(r).toMatchObject({ status: "up", latencyMs: 7, message: "connected" });
    expect(tcp).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(RETRY_DELAY_MS);
  });

  it("keeps the start time across the retry", async () => {
    let clock = NOW;
    const tcp = vi.fn(async () => {
      clock += 5000;
      throw transportError("timeout");
    });
    const r = await runCheck(
      monitor({ type: "tcp", host: "db.example.org", port: 5432 }),
      options(fakeTransport({ tcp }), { now: () => clock }),
    );
    expect(r).toMatchObject({ ts: TS, status: "down", latencyMs: null, message: "timeout" });
  });

  it("retries a degraded attempt too", async () => {
    const tls = vi.fn(async () => tlsProbe(3));
    const r = await runCheck(monitor({ type: "tls", host: "example.org" }), options(fakeTransport({ tls })));
    expect(r.status).toBe("degraded");
    expect(tls).toHaveBeenCalledTimes(2);
  });

  it("never throws, even when the transport throws synchronously or the sleep fails", async () => {
    const tcp = vi.fn(() => {
      throw new Error("boom at db.example.org");
    });
    const sleep = vi.fn(async () => {
      throw new Error("no timers");
    });
    const r = await runCheck(
      monitor({ type: "tcp", host: "db.example.org", port: 5432 }),
      options(fakeTransport({ tcp }), { sleep }),
    );
    expect(r).toMatchObject({ status: "down", latencyMs: null, message: "connection failed" });
  });

  it("maps errors to fixed words and never shows the error text or the target", async () => {
    const cases = [
      ["timeout", "timeout"],
      ["refused", "connection refused"],
      ["refused-message", "connection refused"],
      ["other", "connection failed"],
    ] as const;
    for (const [kind, message] of cases) {
      const tcp = vi.fn(async () => {
        throw transportError(kind);
      });
      const r = await runCheck(
        monitor({ type: "tcp", host: "db.example.org", port: 5432 }),
        options(fakeTransport({ tcp })),
      );
      expect(r.message).toBe(message);
      expect(JSON.stringify(r)).not.toContain("example.org");
    }
  });

  it("answers `not supported` for ping and tls on a transport without them, without throwing", async () => {
    const { ping: _p, tls: _t, ...rest } = fakeTransport();
    for (const m of [
      monitor({ type: "ping", host: "example.org" }),
      monitor({ type: "tls", host: "example.org" }),
    ]) {
      const r = await runCheck(m, options(rest));
      expect(r).toEqual({
        monitorId: "m1",
        ts: TS,
        status: "down",
        latencyMs: null,
        message: "not supported",
      });
    }
  });

  it("rounds latencies to whole milliseconds", async () => {
    const r = await runCheck(
      monitor({ type: "ping", host: "example.org" }),
      options(fakeTransport({ ping: vi.fn(async () => 3.6) })),
    );
    expect(r).toMatchObject({ status: "up", latencyMs: 4, message: "reply" });
  });

  it("uses the real clock and timer by default", async () => {
    const before = Math.floor(Date.now() / 1000) * 1000;
    const r = await runCheck(monitor({ type: "tcp", host: "db.example.org", port: 5432 }), {
      transport: fakeTransport(),
      version: "0.3.0",
    });
    expect(Date.parse(r.ts)).toBeGreaterThanOrEqual(before);
    expect(r.ts).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });
});
