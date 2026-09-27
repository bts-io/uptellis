import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isOpenPath } from "@/worker/middleware/viewer-key";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

/** The trigger strings src/worker/cron.ts dispatches on (read as text: it imports Worker-only types). */
const cronConst = (name: string) =>
  new RegExp(`export const ${name} = "([^"]+)"`).exec(read("src/worker/cron.ts"))?.[1];

describe("Phase 1 wiring", () => {
  it("wrangler.jsonc enables exactly the cron triggers runCron dispatches on", () => {
    // An active (uncommented) triggers line; runCron picks the job by these exact strings.
    const m = /^\s*"triggers":\s*\{\s*"crons":\s*(\[[^\]]*\])\s*\}/m.exec(read("wrangler.jsonc"));
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1]!)).toEqual([
      cronConst("CRON_EVERY_5_MIN"),
      cronConst("CRON_DAILY"),
      cronConst("CRON_EVERY_MINUTE"),
    ]);
    expect(cronConst("CRON_EVERY_5_MIN")).toBe("*/5 * * * *");
  });

  it("the viewer gate leaves only /api/ingest/* and /api/health open", () => {
    for (const p of ["/api/health", "/api/ingest/kuma", "/api/ingest/facts", "/api/ingest/events"]) {
      expect(isOpenPath(p), p).toBe(true);
    }
    for (const p of [
      "/",
      "/api/sites/demo/model",
      "/api/sites/demo/sources",
      "/api/ingest",
      "/api/healthz",
      "/api/health/x",
      "/embed/demo/badge.svg",
      "/x/api/ingest/kuma",
    ]) {
      expect(isOpenPath(p), p).toBe(false);
    }
  });

  it("declares the ingest secrets for typecheck, with optional rotation slots", () => {
    const d = read("src/secrets.d.ts");
    for (const name of ["INGEST_KEY_COLLECTOR_1: string", "INGEST_KEY_FACTS_1: string"])
      expect(d).toContain(name);
    for (const name of ["INGEST_KEY_COLLECTOR_1_NEXT?: string", "INGEST_KEY_FACTS_1_NEXT?: string"]) {
      expect(d).toContain(name);
    }
  });
});
