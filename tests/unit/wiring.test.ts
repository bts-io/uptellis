import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JOBS } from "@/platform/types";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

describe("Phase 1 wiring", () => {
  it("wrangler.jsonc enables exactly the cron triggers of JOBS", () => {
    // An active (uncommented) triggers line; the scheduled handler maps these exact strings to their jobs.
    const m = /^\s*"triggers":\s*\{\s*"crons":\s*(\[[^\]]*\])\s*\}/m.exec(read("wrangler.jsonc"));
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1]!).sort()).toEqual(Object.values(JOBS).sort());
  });

  it("declares the master key for typecheck and no env ingest secrets", () => {
    const d = read("src/secrets.d.ts");
    expect(d).toContain("SOURCE_MASTER_KEY: string");
    expect(d).not.toContain("INGEST_KEY_");
  });
});
