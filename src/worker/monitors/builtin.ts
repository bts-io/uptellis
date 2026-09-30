/**
 * The builtin runner: the every-minute `probes` job. For each site, the enabled monitors that list
 * `builtin`, are due this minute (`isDue`) and have a type this runtime runs (`RUNNER_TYPES`: `http` and
 * `tcp` on Cloudflare, all four in Docker) are checked concurrently (at most `BUILTIN_CONCURRENCY` at a
 * time, under the Worker's six open connections) and their results go to `applyResults` as runner
 * `builtin`, which reports as `probe:cf` on Cloudflare and `probe:server` in Docker. The legacy `probes`
 * are monitors too (`monitorsOf`), so `probe:<id>` keeps its history. A failing site is logged by error
 * name and does not stop the others.
 */
import {
  BUILTIN_RUNNER,
  type CheckOptions,
  type CheckResult,
  monitorRunners,
  monitorsOf,
  type RunCheck,
} from "@/shared/monitors";
import { type ConfigSource, getSiteConfig } from "../engine/sites";
import { type ApplyContext, applyResults, type MonitorsBackend, runnerCanRun } from "./apply";
import { isDue, mapBounded } from "./schedule";

export const BUILTIN_CONCURRENCY = 6;

export interface BuiltinRun {
  sites: number;
  checks: number;
  /** Checks whose own result was `down`. */
  down: number;
  opened: string[];
  resolved: string[];
  failedSites: number;
}

export interface BuiltinRunOptions extends Omit<CheckOptions, "now"> {
  runCheck: RunCheck;
  /** Clock (epoch ms) for the checks and for applying their results; defaults to the real time. */
  now?: () => number;
}

export async function runBuiltin(
  backend: MonitorsBackend & { configs: ConfigSource },
  runtime: ApplyContext["runtime"],
  scheduledMs: number,
  options: BuiltinRunOptions,
): Promise<BuiltinRun> {
  const { configs } = backend;
  const clock = options.now ?? (() => Date.now());
  const { runCheck, transport, version, sleep } = options;
  const run: BuiltinRun = { sites: 0, checks: 0, down: 0, opened: [], resolved: [], failedSites: 0 };
  for (const site of await configs.slugs()) {
    const config = await getSiteConfig(configs, site);
    const due = (config ? monitorsOf(config) : []).filter(
      (m) =>
        m.enabled &&
        monitorRunners(m).includes(BUILTIN_RUNNER) &&
        runnerCanRun(BUILTIN_RUNNER, m.type, runtime) &&
        isDue(m, scheduledMs),
    );
    if (due.length === 0) continue;
    run.sites++;
    try {
      const results: CheckResult[] = await mapBounded(due, BUILTIN_CONCURRENCY, (m) =>
        runCheck(m, { transport, version, sleep, now: clock }),
      );
      const outcome = await applyResults(
        backend,
        { site, runner: BUILTIN_RUNNER, runtime },
        results,
        new Date(clock()),
      );
      run.checks += results.length;
      run.down += results.filter((r) => r.status === "down").length;
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
