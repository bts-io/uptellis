/**
 * The every-minute probe run: for each site with probes, the checks due this minute run concurrently
 * (at most `PROBE_CONCURRENCY` at a time, under the Worker's six open connections), their results become
 * one `ModelDelta` for source `probe:cf`, and the delta goes through the same engine path as an ingest
 * (`applyIngestDelta`): heartbeats, incidents, source freshness and `latest:<site>` move exactly as they do
 * for a Kuma snapshot. A failing site is logged by error name and does not stop the others.
 */
import { PROBE_SOURCE_ID } from "@/shared/config";
import { normalizeProbes, type ProbeCheck } from "../adapters/probe";
import { applyIngestDelta, type IngestBackend } from "../engine/ingest-service";
import { type ConfigSource, getSiteConfig, syncSiteSources } from "../engine/sites";
import { type CheckOptions, checkProbe } from "./checker";
import { isDue, mapBounded } from "./schedule";

export const PROBE_CONCURRENCY = 6;

export interface ProbeRun {
  sites: number;
  checks: number;
  down: number;
  opened: string[];
  resolved: string[];
  failedSites: number;
}

export interface ProbeRunOptions extends CheckOptions {
  /** Clock for source freshness after the checks; defaults to the real time. */
  now?: () => Date;
}

export async function runProbes(
  backend: IngestBackend & { configs: ConfigSource },
  scheduledMs: number,
  options: ProbeRunOptions = {},
): Promise<ProbeRun> {
  const { store, configs } = backend;
  const run: ProbeRun = { sites: 0, checks: 0, down: 0, opened: [], resolved: [], failedSites: 0 };
  for (const site of await configs.slugs()) {
    const due = (await getSiteConfig(configs, site))?.probes.filter((p) => isDue(p, scheduledMs)) ?? [];
    if (due.length === 0) continue;
    run.sites++;
    try {
      await syncSiteSources(store, configs, site);
      const results = await mapBounded(due, PROBE_CONCURRENCY, (p) => checkProbe(p, options));
      const checks: ProbeCheck[] = due.map((probe, i) => ({ probe, result: results[i]! }));
      const previous = (await store.currentServices(site)).filter((s) => s.source === PROBE_SOURCE_ID);
      const now = options.now?.() ?? new Date();
      const delta = normalizeProbes(checks, PROBE_SOURCE_ID, site, new Date(scheduledMs), now, { previous });
      const outcome = await applyIngestDelta(backend, { site, source: PROBE_SOURCE_ID }, delta, now);
      run.checks += checks.length;
      run.down += checks.filter((c) => c.result.status === "down").length;
      run.opened.push(...outcome.incidents.opened);
      run.resolved.push(...outcome.incidents.resolved);
    } catch (err) {
      run.failedSites++;
      console.warn(
        JSON.stringify({ evt: "probes", site, name: err instanceof Error ? err.name : "unknown" }),
      );
    }
  }
  return run;
}
