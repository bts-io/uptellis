/**
 * runCheck over the Bun transport against real local targets: an HTTP server, open and closed TCP ports,
 * TLS servers with certificates made at test time, and ping to the loopback address. The quick retry's
 * pause is skipped (a no-op sleep); timeouts are real.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import net from "node:net";
import tls from "node:tls";
import { runCheck } from "@/checks";
import { createBunTransport } from "@/checks/bun-transport";
import { CheckResult } from "@/shared/monitors/api";
import type { CheckOptions } from "@/shared/monitors/check";
import {
  CA_NAME,
  CERT_NAME,
  canPing,
  hasOpenssl,
  LOOPBACK,
  makeCerts,
  monitor,
  noWait,
  type TestCerts,
} from "./support";

const transport = createBunTransport();
const opts = (over: Partial<CheckOptions> = {}): CheckOptions => ({
  transport,
  version: "0.3.0",
  sleep: noWait,
  ...over,
});

/** Checks the result shape and that no message or certificate field names the loopback address. */
function valid(r: CheckResult) {
  expect(CheckResult.safeParse(r).success).toBe(true);
  expect(JSON.stringify(r)).not.toContain(LOOPBACK);
  return r;
}

/** Listens on the loopback address and resolves the port. */
const listen = (server: net.Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, LOOPBACK, () => resolve((server.address() as net.AddressInfo).port)),
  );

/** A port nothing listens on: bound once, then closed. */
async function closedPort() {
  const s = net.createServer();
  const port = await listen(s);
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}

describe("http", () => {
  const seen: { path: string; method: string; ua: string | null }[] = [];
  let server: ReturnType<typeof Bun.serve>;
  let base: string;

  beforeAll(() => {
    server = Bun.serve({
      hostname: LOOPBACK,
      port: 0,
      async fetch(req) {
        const { pathname } = new URL(req.url);
        seen.push({ path: pathname, method: req.method, ua: req.headers.get("user-agent") });
        switch (pathname) {
          case "/ok":
            return new Response("<p>All good</p>");
          case "/fail":
            return new Response("broken", { status: 503 });
          case "/moved":
            return new Response(null, { status: 302, headers: { location: "/ok" } });
          case "/slow":
            await Bun.sleep(3000);
            return new Response("late");
          default:
            return new Response("missing", { status: 404 });
        }
      },
    });
    base = `http://${LOOPBACK}:${server.port}`;
  });
  afterAll(() => server.stop(true));

  it("is up on 200 with the user agent and a latency", async () => {
    const r = valid(await runCheck(monitor({ type: "http", url: `${base}/ok` }), opts()));
    expect(r).toMatchObject({ status: "up", message: "HTTP 200" });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(seen.at(-1)).toEqual({ path: "/ok", method: "GET", ua: "uptellis/0.3.0" });
  });

  it("is down on 503 after two requests, and on a status outside a custom range", async () => {
    const before = seen.length;
    expect(valid(await runCheck(monitor({ type: "http", url: `${base}/fail` }), opts()))).toMatchObject({
      status: "down",
      message: "HTTP 503",
    });
    expect(seen.length - before).toBe(2);
    const r = await runCheck(
      monitor({ type: "http", url: `${base}/nope`, expectStatus: { min: 200, max: 299 } }),
      opts(),
    );
    expect(r).toMatchObject({ status: "down", message: "HTTP 404" });
  });

  it("never follows a redirect", async () => {
    const before = seen.length;
    const r = await runCheck(
      monitor({ type: "http", url: `${base}/moved`, expectStatus: { min: 200, max: 299 } }),
      opts(),
    );
    expect(r).toMatchObject({ status: "down", message: "HTTP 302" });
    expect(seen.slice(before).map((s) => s.path)).toEqual(["/moved", "/moved"]);
    expect(await runCheck(monitor({ type: "http", url: `${base}/moved` }), opts())).toMatchObject({
      status: "up",
      message: "HTTP 302",
    });
  });

  it("sends HEAD when configured", async () => {
    await runCheck(monitor({ type: "http", url: `${base}/ok`, method: "HEAD" }), opts());
    expect(seen.at(-1)).toMatchObject({ path: "/ok", method: "HEAD" });
  });

  it("checks a keyword present, missing and inverted", async () => {
    const url = `${base}/ok`;
    expect(await runCheck(monitor({ type: "http", url, keyword: "All good" }), opts())).toMatchObject({
      status: "up",
    });
    expect(await runCheck(monitor({ type: "http", url, keyword: "Broken" }), opts())).toMatchObject({
      status: "down",
      message: "keyword missing",
    });
    expect(
      await runCheck(monitor({ type: "http", url, keyword: "All good", keywordAbsent: true }), opts()),
    ).toMatchObject({ status: "down", message: "keyword found" });
  });

  it("times out after timeoutS", async () => {
    const started = Date.now();
    const r = valid(await runCheck(monitor({ type: "http", url: `${base}/slow`, timeoutS: 1 }), opts()));
    expect(r).toMatchObject({ status: "down", latencyMs: null, message: "timeout" });
    expect(Date.now() - started).toBeLessThan(2900);
  });

  it("reports a refused connection", async () => {
    const r = valid(
      await runCheck(monitor({ type: "http", url: `http://${LOOPBACK}:${await closedPort()}/` }), opts()),
    );
    expect(r).toMatchObject({ status: "down", latencyMs: null, message: "connection refused" });
  });
});

describe("tcp", () => {
  const server = net.createServer((s) => s.end());
  let port: number;
  beforeAll(async () => {
    port = await listen(server);
  });
  afterAll(() => server.close());

  it("is up on an open port", async () => {
    const r = valid(await runCheck(monitor({ type: "tcp", host: LOOPBACK, port }), opts()));
    expect(r).toMatchObject({ status: "up", message: "connected" });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("is down with `connection refused` on a closed port", async () => {
    const r = valid(
      await runCheck(monitor({ type: "tcp", host: LOOPBACK, port: await closedPort() }), opts()),
    );
    expect(r).toMatchObject({ status: "down", latencyMs: null, message: "connection refused" });
  });
});

describe.skipIf(!hasOpenssl())("tls (certificates made with openssl)", () => {
  let certs: TestCerts;
  const servers: net.Server[] = [];
  const ports: Record<"good" | "short" | "expired" | "self" | "plain" | "silent", number> = {} as never;
  let trusting: ReturnType<typeof createBunTransport>;

  beforeAll(async () => {
    certs = makeCerts();
    trusting = createBunTransport({ tlsCa: [certs.ca] });
    const serve = async (server: net.Server) => {
      servers.push(server);
      return listen(server);
    };
    const tlsServer = (cert: string, key = certs.key) => tls.createServer({ cert, key }, (s) => s.end());
    ports.good = await serve(tlsServer(certs.good));
    ports.short = await serve(tlsServer(certs.short));
    ports.expired = await serve(tlsServer(certs.expired));
    ports.self = await serve(tlsServer(certs.selfSigned, certs.selfSignedKey));
    ports.plain = await serve(net.createServer((s) => s.end("SSH-2.0-not-tls\r\n")));
    // Accepts and never answers: the handshake times out.
    ports.silent = await serve(net.createServer(() => {}));
  });
  afterAll(() => {
    for (const s of servers) s.close();
    certs?.dispose();
  });

  const check = (port: number, over: Record<string, unknown> = {}, t = trusting) =>
    runCheck(
      monitor({ type: "tls", host: LOOPBACK, port, servername: CERT_NAME, ...over }),
      opts({ transport: t }),
    );

  it("is up with the days left and the certificate summary", async () => {
    const r = valid(await check(ports.good));
    expect(r.status).toBe("up");
    expect(r.message).toMatch(/^(29|30) days left$/);
    expect(r.cert).toMatchObject({ valid: true, cn: CERT_NAME, issuer: CA_NAME });
    expect(r.cert!.daysRemaining).toBeGreaterThanOrEqual(29);
  });

  it("is degraded when the certificate expires within minDays", async () => {
    const r = valid(await check(ports.short));
    expect(r).toMatchObject({ status: "degraded", cert: { valid: true } });
    expect(r.message).toMatch(/^[23] days left$/);
    expect(valid(await check(ports.short, { minDays: 1 })).status).toBe("up");
  });

  it("is down on an expired certificate", async () => {
    const r = valid(await check(ports.expired));
    expect(r).toMatchObject({ status: "down", message: "certificate expired", cert: { valid: false } });
    expect(r.cert!.daysRemaining).toBeLessThan(0);
  });

  it("is down on an untrusted chain or a certificate for another name", async () => {
    expect(valid(await check(ports.self))).toMatchObject({ status: "down", message: "certificate invalid" });
    expect(valid(await check(ports.good, {}, transport))).toMatchObject({
      status: "down",
      message: "certificate invalid",
    });
    expect(valid(await check(ports.good, { servername: "other.example.org" }))).toMatchObject({
      status: "down",
      message: "certificate invalid",
      cert: { cn: CERT_NAME },
    });
  });

  it("is down without a certificate when the handshake fails, is refused or times out", async () => {
    expect(valid(await check(ports.plain))).toEqual(
      expect.objectContaining({ status: "down", message: "connection failed" }),
    );
    expect((await check(ports.plain)).cert).toBeUndefined();
    expect(valid(await check(await closedPort()))).toMatchObject({
      status: "down",
      message: "connection refused",
    });
    const r = valid(await check(ports.silent, { timeoutS: 1 }));
    expect(r).toMatchObject({ status: "down", latencyMs: null, message: "timeout" });
  });
});

describe("ping", () => {
  const icmp = canPing();
  if (!icmp)
    console.warn(
      "ping: skipped, ICMP echo to the loopback address is not permitted here (no ping binary or no permission)",
    );

  it.skipIf(!icmp)("is up with the round trip to the loopback address", async () => {
    const r = valid(await runCheck(monitor({ type: "ping", host: LOOPBACK }), opts()));
    expect(r).toMatchObject({ status: "up", message: "reply" });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("refuses a host that would read as an option, without spawning ping", async () => {
    const r = await runCheck(monitor({ type: "ping", host: "-c" }), opts());
    expect(r).toMatchObject({ status: "down", message: "ping failed" });
  });

  it("is down when the ping binary is missing", async () => {
    const t = createBunTransport({ pingPath: "/nonexistent/ping" });
    const r = await runCheck(monitor({ type: "ping", host: LOOPBACK }), opts({ transport: t }));
    expect(r).toMatchObject({ status: "down", latencyMs: null, message: "ping failed" });
  });
});
