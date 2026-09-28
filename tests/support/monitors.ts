/**
 * Monitors over memory for unit tests: runner states in a map (the contract `SqlRunnerStates` satisfies),
 * a `ConfigSource` over given site configs, and a backend for `applyResults` on the in-memory store.
 */
import { parseSiteConfig, type SiteConfig } from "@/shared/config";
import type { RunnerState } from "@/shared/monitors";
import type { ConfigSource } from "@/worker/engine/sites";
import type { InMaintenance, MonitorsBackend } from "@/worker/monitors/apply";
import type { MonitorRunnerState, RunnerStateStore } from "@/worker/monitors/runner-state";
import { MemoryCache, MemoryStore } from "./memory-store";

export class MemoryRunnerStates implements RunnerStateStore {
  /** Keyed `${site}|${monitorId}|${runner}`. */
  readonly rows = new Map<string, RunnerState>();
  saves = 0;

  async load(site: string, monitorIds: readonly string[]): Promise<Map<string, RunnerState[]>> {
    const out = new Map<string, RunnerState[]>();
    for (const [k, s] of this.rows) {
      const [rowSite, monitorId] = k.split("|") as [string, string];
      if (rowSite !== site || !monitorIds.includes(monitorId)) continue;
      out.set(monitorId, [...(out.get(monitorId) ?? []), { ...s }]);
    }
    return out;
  }

  async save(site: string, states: readonly MonitorRunnerState[]): Promise<void> {
    this.saves++;
    for (const { monitorId, state } of states) {
      const k = `${site}|${monitorId}|${state.runner}`;
      const cur = this.rows.get(k);
      if (!cur || cur.lastTs < state.lastTs) this.rows.set(k, { ...state });
    }
  }

  get(site: string, monitorId: string, runner: string): RunnerState | undefined {
    return this.rows.get(`${site}|${monitorId}|${runner}`);
  }
}

/** A `ConfigSource` over fixed configs (each version 1). */
export function configSourceOf(...configs: SiteConfig[]): ConfigSource {
  const by = new Map(configs.map((c) => [c.slug, c]));
  return {
    current: async (slug) => {
      const config = by.get(slug);
      return config ? { config, version: 1, savedAt: "1970-01-01T00:00:00Z", savedBy: "seed" } : null;
    },
    slugs: async () => [...by.keys()],
  };
}

/** A site config with the given monitors and agents on top of a minimal valid one. */
export function monitorSite(over: Record<string, unknown> = {}): SiteConfig {
  return parseSiteConfig({
    v: 1,
    slug: "demo",
    name: "Demo",
    hostnames: ["status.example.com"],
    theme: "a-sys-status",
    sources: [],
    sections: [],
    branding: { title: "Demo" },
    ...over,
  });
}

export function memoryMonitors(config: SiteConfig, inMaintenance?: InMaintenance) {
  const store = new MemoryStore([]);
  const cache = new MemoryCache();
  const runners = new MemoryRunnerStates();
  const backend: MonitorsBackend = {
    store,
    cache,
    runners,
    configs: configSourceOf(config),
    ...(inMaintenance ? { inMaintenance } : {}),
  };
  return { store, cache, runners, backend };
}
