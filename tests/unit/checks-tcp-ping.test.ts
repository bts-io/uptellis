import { describe, expect, it, vi } from "vitest";
import { runCheck } from "@/checks";
import { parsePingRtt } from "@/checks/bun-transport";
import { fakeTransport, monitor, options, transportError } from "../support/fake-check-transport";

describe("runCheck tcp", () => {
  it("passes host, port and the timeout in ms, and is up with the connect latency", async () => {
    const tcp = vi.fn(async () => ({ latencyMs: 8.2 }));
    const r = await runCheck(
      monitor({ type: "tcp", host: "db.example.org", port: 5432, timeoutS: 3 }),
      options(fakeTransport({ tcp })),
    );
    expect(tcp).toHaveBeenCalledExactlyOnceWith("db.example.org", 5432, 3000);
    expect(r).toMatchObject({ status: "up", latencyMs: 8, message: "connected" });
  });

  it("is down with `connection refused` on a closed port", async () => {
    const tcp = vi.fn(async () => {
      throw transportError("refused");
    });
    const r = await runCheck(
      monitor({ type: "tcp", host: "db.example.org", port: 1 }),
      options(fakeTransport({ tcp })),
    );
    expect(r).toMatchObject({ status: "down", latencyMs: null, message: "connection refused" });
  });
});

describe("runCheck ping", () => {
  it("passes host and timeout, and is up with the round trip", async () => {
    const ping = vi.fn(async () => 1.2);
    const r = await runCheck(
      monitor({ type: "ping", host: "office-gw", timeoutS: 2 }),
      options(fakeTransport({ ping })),
    );
    expect(ping).toHaveBeenCalledExactlyOnceWith("office-gw", 2000);
    expect(r).toMatchObject({ status: "up", latencyMs: 1, message: "reply" });
  });

  it("is down with `timeout` or `ping failed`, never the error text", async () => {
    for (const [kind, message] of [
      ["timeout", "timeout"],
      ["other", "ping failed"],
      ["refused", "ping failed"],
    ] as const) {
      const ping = vi.fn(async () => {
        throw transportError(kind);
      });
      const r = await runCheck(
        monitor({ type: "ping", host: "example.org" }),
        options(fakeTransport({ ping })),
      );
      expect(r).toMatchObject({ status: "down", latencyMs: null, message });
    }
  });
});

describe("parsePingRtt", () => {
  it("reads the reply time (iputils, busybox, sub-millisecond) or the rtt summary", () => {
    expect(parsePingRtt("64 bytes from h: icmp_seq=1 ttl=64 time=0.021 ms")).toBe(0.021);
    expect(parsePingRtt("64 bytes from h: seq=0 ttl=64 time=12.5 ms")).toBe(12.5);
    expect(parsePingRtt("reply from h: time<1 ms")).toBe(1);
    expect(parsePingRtt("rtt min/avg/max/mdev = 1.0/2.5/3.0/0.1 ms")).toBe(2.5);
    expect(parsePingRtt("1 packets transmitted, 0 received, 100% packet loss")).toBeNull();
  });
});
