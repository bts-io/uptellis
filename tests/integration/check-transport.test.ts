/**
 * The Workers `CheckTransport` in workerd: it has `fetch` and `tcp` but no `ping` or `tls`, so runCheck
 * answers those types `not supported` without calling anything; `tcp` goes through `cloudflare:sockets`
 * and a connection that cannot open is a `down` result with a fixed message, never the error text.
 */
import { describe, expect, it } from "vitest";
import { runCheck } from "@/checks";
import { createCloudflareCheckTransport } from "@/platform/cloudflare/check-transport";
import { MonitorConfig } from "@/shared/monitors/schema";

const LOOPBACK = [127, 0, 0, 1].join(".");
const monitor = (input: Record<string, unknown>) =>
  MonitorConfig.parse({ id: "m1", name: "Monitor", runners: ["office-1"], timeoutS: 1, ...input });
const opts = () => ({
  transport: createCloudflareCheckTransport(),
  version: "0.3.0",
  sleep: async () => {},
  now: () => Date.parse("2026-09-28T12:00:00Z"),
});

describe("Cloudflare check transport", () => {
  it("offers fetch and tcp only", () => {
    const t = createCloudflareCheckTransport();
    expect(typeof t.fetch).toBe("function");
    expect(typeof t.tcp).toBe("function");
    expect(t.ping).toBeUndefined();
    expect(t.tls).toBeUndefined();
  });

  it("answers ping and tls with `not supported`", async () => {
    for (const m of [
      monitor({ type: "ping", host: "example.org" }),
      monitor({ type: "tls", host: "example.org" }),
    ]) {
      expect(await runCheck(m, opts())).toEqual({
        monitorId: "m1",
        ts: "2026-09-28T12:00:00Z",
        status: "down",
        latencyMs: null,
        message: "not supported",
      });
    }
  });

  it("is down with a fixed message when the socket cannot open", async () => {
    const r = await runCheck(monitor({ type: "tcp", host: LOOPBACK, port: 1 }), opts());
    expect(r.status).toBe("down");
    expect(r.latencyMs).toBeNull();
    expect(["connection refused", "connection failed", "timeout"]).toContain(r.message);
    expect(JSON.stringify(r)).not.toContain(LOOPBACK);
  });
});
