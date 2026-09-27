import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { INGEST_HEADERS } from "@/shared/signing";
import { limitBeforeGates, limitGateRejection, RETRY_AFTER_S } from "@/worker/middleware/rate-limit";
import { notFound } from "@/worker/middleware/viewer-key";

// The real Workers Rate Limiting bindings from wrangler.jsonc, as workerd runs them. Each case uses its own
// client name so the counters of one case never reach another.
const req = (path: string, client: string, init: RequestInit = {}) =>
  new Request(`https://status.example${path}`, {
    ...init,
    headers: { "cf-connecting-ip": client, ...(init.headers as Record<string, string> | undefined) },
  });

/**
 * workerd's local limiter counts in windows aligned to the wall clock minute; a case that straddled a
 * boundary would see its counter reset halfway, so each counting case starts clear of one.
 */
async function awayFromMinuteBoundary(): Promise<void> {
  const into = Date.now() % 60_000;
  if (into > 55_000) await new Promise((r) => setTimeout(r, 60_000 - into + 100));
}

async function firstLimited(make: () => Request, max: number): Promise<number> {
  await awayFromMinuteBoundary();
  for (let i = 1; i <= max; i++) {
    const res = await limitBeforeGates(make(), env);
    if (res) {
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe(String(RETRY_AFTER_S));
      return i;
    }
  }
  return -1;
}

describe("rate limit bindings", () => {
  it("are bound in the Worker", () => {
    for (const b of [env.INGEST_RATE_LIMIT, env.GATE_RATE_LIMIT, env.ADMIN_WRITE_RATE_LIMIT]) {
      expect(typeof b.limit).toBe("function");
    }
  });

  it("stop key guessing after 20 requests a minute from one client", async () => {
    expect(await firstLimited(() => req("/?key=guess", "gate-client"), 25)).toBe(21);
    // Another client is not affected.
    expect(await limitBeforeGates(req("/?key=guess", "gate-other"), env)).toBeNull();
  });

  it("turn repeated gate 404s into 429", async () => {
    await awayFromMinuteBoundary();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await limitGateRejection(req("/", "cookie-client"), env, notFound("/"))).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 404)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("allow 60 ingest posts a minute per key id and client", async () => {
    const post = () =>
      req("/api/ingest/kuma", "collector-host", {
        method: "POST",
        body: "{}",
        headers: { [INGEST_HEADERS.keyId]: "collector-1" },
      });
    expect(await firstLimited(post, 65)).toBe(61);
  });

  it("allow 30 admin writes a minute per client", async () => {
    const put = () => req("/api/admin/sites/demo/config", "admin-client", { method: "PUT", body: "{}" });
    expect(await firstLimited(put, 35)).toBe(31);
  });
});
