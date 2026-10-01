/**
 * Two facts sources reporting the same keys (the two nodes of a forgejo-ha pair) through the ingest service
 * on the migrated D1: each keeps its own rows and samples, in whichever order they push.
 */
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { schema } from "@/worker/db";
import { ingestPayload } from "@/worker/engine/ingest-service";
import { appBackend } from "@/worker/index";
import { PAIR_AT, pairPayload } from "../support/pair-payloads";
import { testPlatform } from "../support/platform";

const NOW = new Date("2026-09-27T23:58:00Z");
const platform = testPlatform();
const backend = appBackend(platform);

const push = (source: string, node: string, peer: string, role: "primary" | "standby", disk: number) =>
  ingestPayload(backend, "facts", { site: "demo", source }, pairPayload(node, peer, role, disk), NOW);

describe("facts per source on D1", () => {
  it.each([
    ["the standby last", ["facts:app-1", "facts:app-2"]],
    ["the primary last", ["facts:app-2", "facts:app-1"]],
  ])("keeps both nodes' facts and samples with %s", async (_, order) => {
    for (const source of order) {
      const res =
        source === "facts:app-1"
          ? await push(source, "app-1", "app-2", "primary", 16)
          : await push(source, "app-2", "app-1", "standby", 12);
      expect(res.counts.facts).toBe(5);
    }
    const model = await backend.store.loadSiteModel("demo", NOW.toISOString());
    const roles = model.facts
      .filter((f) => f.group === "replication" && f.key === "role")
      .map((f) => [f.source, f.value.value]);
    expect(roles).toEqual([
      ["facts:app-1", "primary"],
      ["facts:app-2", "standby"],
    ]);
    const cached = await backend.cache.get("demo");
    expect(cached?.facts.filter((f) => f.group === "disk").map((f) => [f.source, f.value.value])).toEqual([
      ["facts:app-1", 16],
      ["facts:app-2", 12],
    ]);
    // Both nodes sampled the disk at the same instant; neither sample is dropped.
    const samples = await platform.db
      .select({ source: schema.factSamples.source, value: schema.factSamples.value })
      .from(schema.factSamples)
      .where(
        and(
          eq(schema.factSamples.site, "demo"),
          eq(schema.factSamples.grp, "disk"),
          eq(schema.factSamples.ts, Date.parse(PAIR_AT)),
        ),
      )
      .orderBy(schema.factSamples.source);
    expect(samples).toEqual([
      { source: "facts:app-1", value: 16 },
      { source: "facts:app-2", value: 12 },
    ]);
  });
});
