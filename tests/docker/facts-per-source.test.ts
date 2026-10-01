/** Two facts sources reporting the same keys through the ingest service on SQLite: both keep their rows. */
import { afterEach, describe, expect, it } from "bun:test";
import { ingestPayload } from "@/worker/engine/ingest-service";
import { appBackend } from "@/worker/index";
import { pairPayload } from "../support/pair-payloads";
import { type TempPlatform, tempPlatform } from "./support";

const NOW = new Date("2026-09-27T23:58:00Z");
let t: TempPlatform;
afterEach(() => t?.dispose());

describe("facts per source on SQLite", () => {
  it("keeps the primary's and the standby's facts side by side", async () => {
    t = tempPlatform({}, NOW.getTime());
    const backend = appBackend(t.platform);
    const push = (source: string, node: string, peer: string, role: "primary" | "standby", disk: number) =>
      ingestPayload(backend, "facts", { site: "demo", source }, pairPayload(node, peer, role, disk), NOW);
    await push("facts:app-1", "app-1", "app-2", "primary", 16);
    await push("facts:app-2", "app-2", "app-1", "standby", 12);
    const model = await backend.store.loadSiteModel("demo", NOW.toISOString());
    expect(model.facts.filter((f) => f.group === "disk").map((f) => [f.source, f.value.value])).toEqual([
      ["facts:app-1", 16],
      ["facts:app-2", 12],
    ]);
    expect(model.facts).toHaveLength(10);
  });
});
