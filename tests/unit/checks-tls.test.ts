import type { PeerCertificate } from "node:tls";
import { describe, expect, it, vi } from "vitest";
import { daysLeftMessage, runCheck } from "@/checks";
import { certSummary } from "@/checks/bun-transport";
import { CheckResult } from "@/shared/monitors/api";
import {
  DAY_MS,
  fakeTransport,
  monitor,
  NOW,
  options,
  tlsProbe,
  transportError,
} from "../support/fake-check-transport";

const tlsMonitor = (over: Record<string, unknown> = {}) =>
  monitor({ type: "tls", host: "example.org", ...over });
const run = (days: number, authorized = true, over: Record<string, unknown> = {}) =>
  runCheck(tlsMonitor(over), options(fakeTransport({ tls: vi.fn(async () => tlsProbe(days, authorized)) })));

describe("runCheck tls", () => {
  it("is up with the days left and the certificate", async () => {
    const r = await run(30);
    expect(r).toMatchObject({ status: "up", latencyMs: 20, message: "30 days left" });
    expect(r.cert).toMatchObject({ valid: true, cn: "example.org", issuer: "Example CA", daysRemaining: 30 });
    expect(CheckResult.safeParse(r).success).toBe(true);
  });

  it("is degraded under minDays (default 7) and up at it", async () => {
    expect(await run(3)).toMatchObject({ status: "degraded", message: "3 days left" });
    expect(await run(7)).toMatchObject({ status: "up", message: "7 days left" });
    expect(await run(1, true, { minDays: 0 })).toMatchObject({ status: "up", message: "1 day left" });
    expect(await run(12, true, { minDays: 14 })).toMatchObject({
      status: "degraded",
      message: "12 days left",
    });
  });

  it("is down when the certificate expired or the chain is invalid, keeping the certificate", async () => {
    const expired = await run(-2, false);
    expect(expired).toMatchObject({ status: "down", message: "certificate expired" });
    expect(expired.cert).toMatchObject({ valid: false });
    const invalid = await run(40, false);
    expect(invalid).toMatchObject({ status: "down", message: "certificate invalid" });
    expect(invalid.cert).toMatchObject({ valid: false, daysRemaining: 40 });
  });

  it("is expired at the expiry instant even with 0 days left", async () => {
    const probe = tlsProbe(0);
    probe.cert.validTo = new Date(NOW - 1000).toISOString();
    const r = await runCheck(tlsMonitor(), options(fakeTransport({ tls: vi.fn(async () => probe) })));
    expect(r).toMatchObject({ status: "down", message: "certificate expired" });
  });

  it("sends servername as SNI, else the host", async () => {
    const tls = vi.fn(async () => tlsProbe(30));
    const t = fakeTransport({ tls });
    await runCheck(tlsMonitor({ host: [203, 0, 113, 9].join("."), servername: "example.org" }), options(t));
    await runCheck(tlsMonitor({ port: 8443, timeoutS: 5 }), options(t));
    expect(tls.mock.calls[0]!.slice(2)).toEqual(["example.org", 10_000]);
    expect(tls.mock.calls[1]).toEqual(["example.org", 8443, "example.org", 5000]);
  });

  it("is down without a certificate when the handshake fails", async () => {
    const tls = vi.fn(async () => {
      throw transportError("refused");
    });
    const r = await runCheck(tlsMonitor(), options(fakeTransport({ tls })));
    expect(r).toEqual({
      monitorId: "m1",
      ts: "2026-09-28T12:00:00Z",
      status: "down",
      latencyMs: null,
      message: "connection refused",
    });
  });

  it("drops a CN that is not display-safe (an address) but keeps the rest", async () => {
    const probe = tlsProbe(30, true, [192, 0, 2, 7].join("."));
    const r = await runCheck(tlsMonitor(), options(fakeTransport({ tls: vi.fn(async () => probe) })));
    expect(r.cert).toMatchObject({ cn: null, issuer: "Example CA", daysRemaining: 30 });
    expect(CheckResult.safeParse(r).success).toBe(true);
  });

  it("words the days left", () => {
    expect([0, 1, 2].map(daysLeftMessage)).toEqual(["0 days left", "1 day left", "2 days left"]);
  });
});

describe("certSummary (Bun transport)", () => {
  const peer = (validTo: string, subject: Record<string, unknown>, issuer: Record<string, unknown>) =>
    ({ valid_to: validTo, subject, issuer }) as unknown as PeerCertificate;

  it("reads CN, the issuer organisation (else its CN), expiry and whole days left", () => {
    const now = Date.parse("2026-09-28T00:00:00Z");
    const s = certSummary(
      peer("Oct 10 12:00:00 2026 GMT", { CN: "example.org" }, { O: "Example CA", CN: "R1" }),
      true,
      now,
    );
    expect(s).toEqual({
      valid: true,
      cn: "example.org",
      issuer: "Example CA",
      validTo: "2026-10-10T12:00:00.000Z",
      daysRemaining: 12,
    });
    const other = certSummary(
      peer("Sep 27 00:00:00 2026 GMT", { CN: ["a.example.org", "b"] }, { CN: "R1" }),
      true,
      now,
    );
    expect(other).toMatchObject({ valid: false, cn: "a.example.org", issuer: "R1", daysRemaining: -1 });
    expect(Math.floor((Date.parse(other.validTo) - now) / DAY_MS)).toBe(-1);
  });

  it("refuses a certificate without a readable expiry", () => {
    expect(() => certSummary(peer("never", {}, {}), true, 0)).toThrow();
  });
});
