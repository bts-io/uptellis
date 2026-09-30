/**
 * Phase 10 admin mock-up checker: renders mockups/admin/<dir>/index.html in headless Chrome for every screen
 * (the hash routes in SCREENS) at desktop and phone widths, and fails on an uncaught script error, an empty
 * screen, an external request other than Google Fonts, or an internal id (`probe:...`, `kuma:...`,
 * `facts:...`, `webhook:...`) anywhere in the visible text. It proves the screens render; it says nothing
 * about looks (the lead reviews screenshots).
 * Run: bun mockups/admin/check.ts <dir> [<dir> ...]
 */
export const SCREENS = [
  "first-run",
  "monitors",
  "monitors-empty",
  "create-monitor",
  "monitor",
  "monitor-pending",
  "heartbeats",
  "create-heartbeat",
  "status-page",
  "alerts",
  "settings",
] as const;

const root = new URL(".", import.meta.url).pathname;
const dirs = process.argv.slice(2);
if (dirs.length === 0) throw new Error("usage: bun mockups/admin/check.ts <dir> ...");
let failed = 0;

const probe = `<script>window.addEventListener("error",function(e){var d=document.createElement("pre");d.id="__mockup_error";d.textContent=String(e.message);(document.body||document.documentElement).appendChild(d);});</script>`;

for (const dir of dirs) {
  const base = `${root}${dir}/`;
  const html = await Bun.file(`${base}index.html`).text();
  for (const bad of html.matchAll(/(?:src|href)=["'](https?:)?\/\/(?!fonts\.(?:googleapis|gstatic)\.com)[^"']+/g)) {
    console.log(`FAIL ${dir}: external reference ${bad[0]}`);
    failed++;
  }
  const probed = `${base}.check.html`;
  await Bun.write(probed, html.replace(/<head([^>]*)>/i, (m) => `${m}${probe}`));
  try {
    for (const screen of SCREENS) {
      for (const width of [1440, 390]) {
        const run = Bun.spawnSync([
          "google-chrome", "--headless=new", "--disable-gpu", "--virtual-time-budget=3000",
          `--window-size=${width},1200`, "--dump-dom", `file://${probed}#${screen}`,
        ]);
        const dom = run.stdout.toString();
        const text = dom.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
        const err = dom.match(/<pre id="__mockup_error">([\s\S]*?)<\/pre>/);
        const ids = [...text.matchAll(/\b(?:probe|kuma|facts|webhook):[A-Za-z0-9._-]+/g)].map((m) => m[0]);
        const problems = [
          ...(run.exitCode !== 0 ? [`chrome exited ${run.exitCode}`] : []),
          ...(err ? [`script error: ${err[1]}`] : []),
          ...(text.replace(/\s+/g, " ").trim().length < 200 ? ["empty screen"] : []),
          ...(ids.length ? [`internal ids shown: ${[...new Set(ids)].slice(0, 3).join(", ")}`] : []),
        ];
        if (problems.length) {
          console.log(`FAIL ${dir} #${screen} @${width}: ${problems.join("; ")}`);
          failed++;
        } else console.log(`ok   ${dir} #${screen} @${width}`);
      }
    }
  } finally {
    await Bun.file(probed).delete();
  }
}
process.exit(failed ? 1 : 0);
