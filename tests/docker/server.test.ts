/**
 * The Docker server around the app: static client files, the client address the rate limits see, the
 * request deps handed to the app, and a graceful stop. The app itself is a stub here (the built Start
 * entry needs `bun run build:docker`; scripts/docker-smoke.sh covers the real image).
 */
import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "@/platform/docker/server";
import type { RequestDeps } from "@/worker/serve";
import { MIGRATIONS } from "./support";

const dir = mkdtempSync(join(tmpdir(), "uptellis-server-"));
const clientDir = join(dir, "client");
mkdirSync(join(clientDir, "assets"), { recursive: true });
writeFileSync(join(clientDir, "assets", "app-abc123.js"), "export {};\n");
writeFileSync(join(dir, "secret.txt"), "not served\n");

const seen: { ip: string | null; deps: RequestDeps }[] = [];
const start = (env: Record<string, string>) =>
  startServer({
    env: { PORT: "0", DATABASE_PATH: join(dir, `db-${seen.length}-${Math.random()}.db`), ...env },
    clientDir,
    migrationsFolder: MIGRATIONS,
    handle: async (request, deps) => {
      seen.push({ ip: request.headers.get("cf-connecting-ip"), deps });
      return new Response("app");
    },
  });

let direct: Awaited<ReturnType<typeof start>>;
let legacyNotice: string | undefined;
let proxied: Awaited<ReturnType<typeof start>>;
const url = (s: typeof direct, path: string) => new URL(path, s.server.url).toString();

beforeAll(async () => {
  spyOn(console, "log").mockImplementation(() => {});
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  direct = await start({ INGEST_KEY_COLLECTOR_1: "legacy-secret-value", SITE_DEFAULT: "demo" });
  legacyNotice = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes("INGEST_KEY_COLLECTOR_1"));
  warn.mockRestore();
  proxied = await start({ TRUST_PROXY: "1" });
});
afterAll(async () => {
  await direct.stop("test");
  await proxied.stop("test");
  rmSync(dir, { recursive: true, force: true });
});

describe("docker server", () => {
  it("serves built assets itself, cached for a year, with the security headers", async () => {
    const res = await fetch(url(direct, "/assets/app-abc123.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe("export {};\n");
  });

  it("hands everything else, and missing or escaping asset paths, to the app", async () => {
    for (const path of ["/", "/api/health", "/assets/missing.js", "/assets/..%2f..%2fsecret.txt"]) {
      expect(await (await fetch(url(direct, path))).text(), path).toBe("app");
    }
  });

  it("passes the platform to the app, and only names a leftover INGEST_KEY_* secret in a notice", async () => {
    await fetch(url(direct, "/"));
    const { deps } = seen.at(-1)!;
    expect(deps.bindings.platform.runtime).toBe("docker");
    expect(deps.bindings.platform.setting("SITE_DEFAULT")).toBe("demo");
    expect(Object.keys(deps.bindings)).toEqual(["platform"]);
    const line = JSON.parse(legacyNotice ?? "{}") as { evt?: string; set?: string[]; message?: string };
    expect(line).toMatchObject({ evt: "legacy_keys", set: ["INGEST_KEY_COLLECTOR_1"] });
    expect(line.message).toContain("no longer read");
    expect(legacyNotice).not.toContain("legacy-secret-value");
  });

  it("sets the client address from the socket, replacing a client's own header", async () => {
    await fetch(url(direct, "/"), {
      headers: { "cf-connecting-ip": "spoofed", "x-forwarded-for": "spoofed" },
    });
    expect(seen.at(-1)!.ip).not.toBe("spoofed");
    expect(seen.at(-1)!.ip).toBeTruthy();
  });

  it("takes the last X-Forwarded-For hop behind a trusted proxy", async () => {
    await fetch(url(proxied, "/"), { headers: { "x-forwarded-for": "client-a, proxy-hop" } });
    expect(seen.at(-1)!.ip).toBe("proxy-hop");
  });

  it("stops once: later requests are refused", async () => {
    const s = await start({});
    const base = url(s, "/");
    await Promise.all([s.stop("SIGTERM"), s.stop("SIGTERM")]);
    await expect(fetch(base)).rejects.toThrow();
  });
});
