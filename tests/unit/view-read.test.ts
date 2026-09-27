import { describe, expect, it } from "vitest";
import type { ServiceDays } from "../../src/shared/view";
import { readSiteView } from "../../src/worker/engine/read-service";
import { loadFixture } from "../fixtures";
import { fixtureConfig } from "../fixtures/view";
import { MemoryModelCache, MemoryStore } from "../support/read-memory-store";

const fx = loadFixture("default");
const NOW = Date.parse(fx.now);
const seeded = () =>
  new MemoryStore({
    demo: {
      sources: fx.sources,
      services: fx.services,
      heartbeats: fx.heartbeats,
      incidents: fx.incidents,
      facts: fx.facts,
    },
  });

describe("readSiteView", () => {
  it("builds the view from the model; a store without history gives no-data beat bars", async () => {
    const store = seeded();
    const cache = new MemoryModelCache();
    const { view, warmed } = await readSiteView({ store, cache }, fixtureConfig, NOW);
    await warmed;
    expect(view.verdict.state).toBe("operational");
    expect(view.sections.flatMap((s) => s.services)).toHaveLength(8);
    expect(view.sections[0]!.services[0]!.beatsText).toBe(".".repeat(90));
    expect(cache.models.has("demo")).toBe(true);
  });

  it("asks the store for history at the request time and uses it", async () => {
    const store = seeded();
    const calls: [string, string][] = [];
    const history: ServiceDays[] = [
      {
        serviceId: "kuma:1",
        days: [{ day: "2026-09-27", worst: "degraded", uptime: 0.999, minutesDown: 0 }],
      },
    ];
    Object.assign(store, {
      loadHistory: async (site: string, now: string) => {
        calls.push([site, now]);
        return history;
      },
    });
    const { view } = await readSiteView({ store, cache: new MemoryModelCache() }, fixtureConfig, NOW + 250);
    expect(calls).toEqual([["demo", "2026-09-27T23:58:00Z"]]);
    expect(view.sections[0]!.services[0]!.beatsText.at(-1)).toBe("~");
  });
});
