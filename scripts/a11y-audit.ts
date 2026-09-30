/**
 * Accessibility and contrast audit of every registered theme (`bun run a11y`). Not part of `verify`: it needs
 * a browser and the dev server.
 *
 * For each theme x fixture (default, stale, incident) x viewport (1440x900 desktop, 390x844 phone) x colour
 * scheme (light, dark through emulated prefers-color-scheme) it loads `/_preview?fixture=..&theme=..` in
 * headless Chromium and runs axe-core with the WCAG 2.0/2.1/2.2 A and AA rules (color-contrast included) plus
 * axe's best-practice rules (landmarks, heading order). Findings are printed grouped by theme and rule, the
 * full result goes to the JSON report, and the exit code is 1 when any serious or critical violation is left
 * after the exclusions below (moderate and minor ones are reported but do not fail the run).
 *
 *   bun run a11y [--out report.json] [--url http://localhost:5173] [--theme id,..] [--fixture id,..]
 *
 * --url   use a running dev server; without it the script uses one on localhost:5173 when it answers, and
 *         otherwise starts `bunx vite dev` on a free port and stops it at the end.
 * --out   write the JSON report there.
 *
 * Browser: playwright-core (no bundled browser download, just the driver) launching the Chromium that
 * matches its revision from ~/.cache/ms-playwright, or CHROME_PATH (e.g. /usr/bin/google-chrome) when set.
 * axe-core is injected from node_modules into each page.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { type Browser, chromium, type Page } from "playwright-core";

type Impact = "minor" | "moderate" | "serious" | "critical";

interface AxeNode {
  target: unknown[];
  html: string;
  failureSummary?: string;
  impact?: Impact | null;
}
interface AxeResult {
  id: string;
  impact?: Impact | null;
  help: string;
  helpUrl: string;
  tags: string[];
  nodes: AxeNode[];
}

interface Finding {
  theme: string;
  fixture: string;
  viewport: string;
  scheme: string;
  rule: string;
  impact: Impact;
  help: string;
  target: string;
  html: string;
  summary: string;
}

/**
 * Narrow exclusions. Each names one rule and the exact element it applies to, with the reason; never a whole
 * rule. A finding is dropped when the rule matches, the theme matches (when given) and the target selector
 * matches `target`.
 */
interface Exclusion {
  rule: string;
  theme?: string;
  target: RegExp;
  reason: string;
}
const EXCLUSIONS: Exclusion[] = [];

const ROOT = new URL("..", import.meta.url).pathname;
const FIXTURES = ["default", "stale", "incident"] as const;
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;
const SCHEMES = ["light", "dark"] as const;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];
const IMPACT_RANK: Record<Impact, number> = { minor: 0, moderate: 1, serious: 2, critical: 3 };
const CONCURRENCY = 4;

function args(): Map<string, string> {
  const out = new Map<string, string>();
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const [k, v] = a.includes("=") ? a.slice(2).split(/=(.*)/s) : [a.slice(2), argv[++i]];
    if (v === undefined) throw new Error(`--${k} needs a value`);
    out.set(k!, v);
  }
  return out;
}

/** Registered theme ids, read from the registry so a new theme is audited without touching this script. */
function registeredThemes(): string[] {
  const src = readFileSync(`${ROOT}src/client/themes/index.ts`, "utf8");
  const body = src.slice(src.indexOf("export const THEMES"));
  return [...body.matchAll(/^\s+"([a-z]-[a-z-]+)": \{ module:/gm)].map((m) => m[1]!);
}

async function answers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "localhost", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

/** The base URL of a dev server, and a stop function when this script started it. */
async function devServer(given: string | undefined): Promise<{ base: string; stop: () => void }> {
  if (given) {
    const base = given.replace(/\/$/, "");
    if (!(await answers(`${base}/_preview`))) throw new Error(`no dev server answering at ${base}/_preview`);
    return { base, stop: () => {} };
  }
  if (await answers("http://localhost:5173/_preview"))
    return { base: "http://localhost:5173", stop: () => {} };
  const port = await freePort();
  const base = `http://localhost:${port}`;
  console.log(`a11y: starting vite dev on ${base}`);
  const child = spawn("bunx", ["vite", "dev", "--port", String(port), "--strictPort"], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  const stop = () => {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch {
      // already gone
    }
  };
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`vite dev exited with ${child.exitCode}`);
    if (await answers(`${base}/_preview`)) return { base, stop };
    await Bun.sleep(500);
  }
  stop();
  throw new Error("vite dev did not answer within 120s");
}

const AXE_SOURCE = readFileSync(`${ROOT}node_modules/axe-core/axe.min.js`, "utf8");

interface AxeRun {
  violations: AxeResult[];
  incomplete: AxeResult[];
}

async function audit(page: Page, url: string): Promise<AxeRun> {
  const res = await page.goto(url, { waitUntil: "networkidle" });
  if (!res?.ok()) throw new Error(`${url}: HTTP ${res?.status()}`);
  // Web fonts and the first effects (decrypt, count-ups) settle before axe measures contrast.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (tags) => {
    const r = await (window as any).axe.run(document, { runOnly: { type: "tag", values: tags } });
    return { violations: r.violations, incomplete: r.incomplete } as AxeRun;
  }, TAGS);
}

function excluded(f: Finding): Exclusion | undefined {
  return EXCLUSIONS.find(
    (e) => e.rule === f.rule && (!e.theme || e.theme === f.theme) && e.target.test(f.target),
  );
}

async function main(): Promise<number> {
  const opts = args();
  const only = (key: string, all: readonly string[]) =>
    opts.has(key) ? all.filter((x) => opts.get(key)!.split(",").includes(x)) : [...all];
  const themes = only("theme", registeredThemes());
  const fixtures = only("fixture", FIXTURES);
  if (themes.length === 0 || fixtures.length === 0) throw new Error("no theme or fixture selected");

  const server = await devServer(opts.get("url") ?? process.env.A11Y_BASE_URL);
  let browser: Browser | undefined;
  const findings: Finding[] = [];
  const skipped: (Finding & { reason: string })[] = [];
  const errors: string[] = [];
  // axe's "needs review" results (e.g. text over a gradient, whose contrast it cannot compute): counted per
  // theme and rule in the report, never failing the run.
  const review = new Map<string, number>();
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
    const jobs = themes.flatMap((theme) =>
      fixtures.flatMap((fixture) =>
        VIEWPORTS.flatMap((viewport) => SCHEMES.map((scheme) => ({ theme, fixture, viewport, scheme }))),
      ),
    );
    let next = 0;
    let done = 0;
    const worker = async () => {
      while (next < jobs.length) {
        const job = jobs[next++]!;
        const ctx = await browser!.newContext({
          viewport: { width: job.viewport.width, height: job.viewport.height },
          colorScheme: job.scheme,
        });
        const page = await ctx.newPage();
        const url = `${server.base}/_preview?fixture=${job.fixture}&theme=${job.theme}`;
        try {
          const run = await audit(page, url);
          for (const v of run.incomplete) {
            const key = `${job.theme}\t${v.id}`;
            review.set(key, (review.get(key) ?? 0) + v.nodes.length);
          }
          for (const v of run.violations) {
            for (const n of v.nodes) {
              const f: Finding = {
                theme: job.theme,
                fixture: job.fixture,
                viewport: job.viewport.name,
                scheme: job.scheme,
                rule: v.id,
                impact: (n.impact ?? v.impact ?? "minor") as Impact,
                help: v.help,
                target: n.target.map(String).join(" >> "),
                html: n.html.slice(0, 300),
                summary: n.failureSummary ?? "",
              };
              const ex = excluded(f);
              if (ex) skipped.push({ ...f, reason: ex.reason });
              else findings.push(f);
            }
          }
        } catch (e) {
          errors.push(`${url}: ${(e as Error).message}`);
        } finally {
          await ctx.close();
        }
        done++;
        if (done % 12 === 0 || done === jobs.length) console.log(`a11y: ${done}/${jobs.length} pages`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    await browser?.close();
    server.stop();
  }

  // Grouped report: theme, then rule, each distinct element once with the variants it fails in.
  const byTheme = new Map<string, Map<string, Finding[]>>();
  for (const f of findings) {
    const rules = byTheme.get(f.theme) ?? new Map<string, Finding[]>();
    rules.set(f.rule, [...(rules.get(f.rule) ?? []), f]);
    byTheme.set(f.theme, rules);
  }
  const grouped = themes.map((theme) => {
    const rules = [...(byTheme.get(theme) ?? new Map<string, Finding[]>()).entries()].map(([rule, list]) => {
      const elements = new Map<
        string,
        { html: string; summary: string; impact: Impact; variants: string[] }
      >();
      for (const f of list) {
        const el = elements.get(f.target) ?? {
          html: f.html,
          summary: f.summary,
          impact: f.impact,
          variants: [],
        };
        if (IMPACT_RANK[f.impact] > IMPACT_RANK[el.impact]) el.impact = f.impact;
        el.variants.push(`${f.fixture}/${f.viewport}/${f.scheme}`);
        elements.set(f.target, el);
      }
      const impact = list.reduce<Impact>(
        (m, f) => (IMPACT_RANK[f.impact] > IMPACT_RANK[m] ? f.impact : m),
        "minor",
      );
      return {
        rule,
        impact,
        help: list[0]!.help,
        count: list.length,
        elements: [...elements].map(([target, e]) => ({ target, ...e })),
      };
    });
    rules.sort((a, b) => IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] || a.rule.localeCompare(b.rule));
    return { theme, rules };
  });

  for (const { theme, rules } of grouped) {
    if (rules.length === 0) {
      console.log(`\n${theme}: no violations`);
      continue;
    }
    console.log(`\n${theme}:`);
    for (const r of rules) {
      console.log(`  [${r.impact}] ${r.rule} (${r.count} nodes): ${r.help}`);
      for (const e of r.elements.slice(0, 8)) {
        const v = e.variants.length > 3 ? `${e.variants.length} variants` : e.variants.join(", ");
        console.log(`    ${e.target}  (${v})`);
        const why = e.summary.split("\n").find((l) => /contrast|name|must|should/i.test(l));
        if (why) console.log(`      ${why.trim()}`);
      }
      if (r.elements.length > 8) console.log(`    ... ${r.elements.length - 8} more`);
    }
  }

  const blocking = findings.filter((f) => IMPACT_RANK[f.impact] >= IMPACT_RANK.serious);
  const out = opts.get("out");
  if (out) {
    const report = {
      base: server.base,
      tags: TAGS,
      themes,
      fixtures,
      viewports: VIEWPORTS,
      schemes: SCHEMES,
      totals: {
        findings: findings.length,
        blocking: blocking.length,
        excluded: skipped.length,
        errors: errors.length,
      },
      byTheme: grouped,
      excluded: skipped,
      needsReview: [...review].map(([key, nodes]) => {
        const [theme, rule] = key.split("\t");
        return { theme, rule, nodes };
      }),
      errors,
    };
    writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\na11y: report written to ${out}`);
  }
  if (review.size > 0) {
    console.log(
      "\nneeds review (axe could not decide, e.g. text over a gradient or pseudo element; not failing):",
    );
    for (const [key, nodes] of review) console.log(`  ${key.replace("\t", " ")}: ${nodes} nodes`);
  }
  for (const e of errors) console.error(`a11y: error ${e}`);
  console.log(
    `\na11y: ${findings.length} findings (${blocking.length} serious or critical), ${skipped.length} excluded, ${errors.length} page errors`,
  );
  return blocking.length > 0 || errors.length > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`a11y: ${(e as Error).message}`);
    process.exit(2);
  },
);
