/**
 * Phase 7a mock-up checker: renders mockups/<dir>/index.html in headless Chrome for each state (#healthy,
 * #incident, #stale) at desktop and phone widths, and fails on an uncaught script error, a missing site name
 * or verdict label, an external request other than Google Fonts, or an empty page. It proves the mock-up
 * renders the data; it says nothing about looks (the lead reviews screenshots).
 * Run: bun mockups/check.ts <dir> [<dir> ...]
 */
const root = new URL(".", import.meta.url).pathname;
const demoJs = await Bun.file(`${root}data/demo.js`).text();
const demo = JSON.parse(demoJs.slice(demoJs.indexOf("=") + 1, demoJs.trimEnd().lastIndexOf(";")));
const dirs = process.argv.slice(2);
if (dirs.length === 0) throw new Error("usage: bun mockups/check.ts <dir> ...");
let failed = 0;

// An uncaught error anywhere on the page lands in this marker, which --dump-dom then shows.
const probe = `<script>window.addEventListener("error",function(e){var d=document.createElement("pre");d.id="__mockup_error";d.textContent=String(e.message);(document.body||document.documentElement).appendChild(d);});</script>`;

for (const dir of dirs) {
  const base = `${root}${dir}/`;
  const html = await Bun.file(`${base}index.html`).text();
  for (const bad of html.matchAll(/(?:src|href)=["'](https?:)?\/\/(?!fonts\.(?:googleapis|gstatic)\.com)[^"']+/g)) {
    console.log(`FAIL ${dir}: external reference ${bad[0]}`);
    failed++;
  }
  // A copy with the error probe as the first thing in <head>, next to the original so relative paths work.
  const probed = `${base}.check.html`;
  await Bun.write(probed, html.replace(/<head([^>]*)>/i, (m) => `${m}${probe}`));
  try {
    for (const state of ["healthy", "incident", "stale"] as const) {
      for (const width of [1440, 390]) {
        const run = Bun.spawnSync([
          "google-chrome", "--headless=new", "--disable-gpu", "--virtual-time-budget=3000",
          `--window-size=${width},1200`, "--dump-dom", `file://${probed}#${state}`,
        ]);
        const dom = run.stdout.toString();
        const view = demo[state];
        const text = dom.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");
        const err = dom.match(/<pre id="__mockup_error">([\s\S]*?)<\/pre>/);
        const problems = [
          ...(run.exitCode !== 0 ? [`chrome exited ${run.exitCode}`] : []),
          ...(err ? [`script error: ${err[1]}`] : []),
          ...(text.includes(view.site.name) ? [] : [`site name "${view.site.name}" missing`]),
          ...(text.includes(view.verdict.label) ? [] : [`verdict "${view.verdict.label}" missing`]),
          ...(text.replace(/\s+/g, " ").trim().length < 200 ? ["page nearly empty"] : []),
        ];
        console.log(`${problems.length ? "FAIL" : "ok  "} ${dir} #${state} @${width}${problems.length ? `: ${problems.join("; ")}` : ""}`);
        failed += problems.length ? 1 : 0;
      }
    }
  } finally {
    await Bun.file(probed).delete();
  }
}
process.exit(failed ? 1 : 0);
