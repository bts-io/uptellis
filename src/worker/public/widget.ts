/**
 * The embeddable widget, drawn from a `PublicSummary` only: `renderWidgetHtml` is the self-contained page
 * `GET /embed/:site` serves for an iframe (inline CSS, no script, no external request), and `EMBED_SCRIPT`
 * is `GET /embed.js`, which draws the same markup into `<div data-uptellis="<site>">` from `summary.json`
 * with DOM calls only (text goes through `textContent`, never parsed as HTML) and refreshes every minute.
 */
import type { PublicState, PublicSummary } from "@/shared/public/summary";
import { formatUptime } from "./badge";
import { verdictPublicState } from "./summary";

/** Words for the service states. */
export const STATE_LABEL: Record<PublicState, string> = {
  up: "Up",
  degraded: "Degraded",
  down: "Down",
  maintenance: "Maintenance",
  stale: "Stale",
  unknown: "Unknown",
};

/** How often `embed.js` reloads the summary, ms. */
export const REFRESH_MS = 60_000;

/** The widget's styles, scoped to `.uptellis-w`, light and dark by `prefers-color-scheme`. */
export const WIDGET_CSS = [
  ".uptellis-w{--uw-bg:#fff;--uw-fg:#1f2328;--uw-muted:#59636e;--uw-line:#d1d9e0;--uw-up:#1a7f37;--uw-degraded:#9a6700;--uw-down:#cf222e;--uw-maintenance:#0969da;--uw-grey:#8c959f;box-sizing:border-box;max-width:480px;margin:0;padding:12px 14px;border:1px solid var(--uw-line);border-radius:8px;background:var(--uw-bg);color:var(--uw-fg);font:13px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;text-align:left}",
  "@media (prefers-color-scheme:dark){.uptellis-w{--uw-bg:#0d1117;--uw-fg:#e6edf3;--uw-muted:#9198a1;--uw-line:#3d444d;--uw-up:#3fb950;--uw-degraded:#d29922;--uw-down:#f85149;--uw-maintenance:#4493f8;--uw-grey:#6e7681}}",
  ".uptellis-w *{box-sizing:border-box}",
  ".uptellis-w .uw-head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px;margin:0 0 8px}",
  ".uptellis-w .uw-name{font-weight:600;font-size:14px;overflow-wrap:anywhere}",
  ".uptellis-w .uw-verdict{font-weight:600}",
  ".uptellis-w .uw-sec{margin:10px 0 2px;color:var(--uw-muted);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}",
  ".uptellis-w ul{list-style:none;margin:0;padding:0}",
  ".uptellis-w .uw-svc{display:flex;align-items:center;gap:8px;padding:3px 0;border-top:1px solid var(--uw-line)}",
  ".uptellis-w .uw-svc:first-child{border-top:0}",
  ".uptellis-w .uw-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--uw-grey)}",
  ".uptellis-w .uw-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".uptellis-w .uw-meta{color:var(--uw-muted);font-variant-numeric:tabular-nums}",
  ".uptellis-w .uw-link{display:inline-block;margin-top:10px;color:inherit;font-size:12px}",
  ".uptellis-w .uw-muted{color:var(--uw-muted)}",
  ".uptellis-w .uw-s-up{color:var(--uw-up)}.uptellis-w .uw-dot.uw-s-up{background:var(--uw-up)}",
  ".uptellis-w .uw-s-degraded{color:var(--uw-degraded)}.uptellis-w .uw-dot.uw-s-degraded{background:var(--uw-degraded)}",
  ".uptellis-w .uw-s-down{color:var(--uw-down)}.uptellis-w .uw-dot.uw-s-down{background:var(--uw-down)}",
  ".uptellis-w .uw-s-maintenance{color:var(--uw-maintenance)}.uptellis-w .uw-dot.uw-s-maintenance{background:var(--uw-maintenance)}",
  ".uptellis-w .uw-s-stale,.uptellis-w .uw-s-unknown{color:var(--uw-muted)}",
].join("\n");

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
/** `s` safe in HTML text and quoted attribute values. */
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

/**
 * The widget page for an iframe. `pageUrl` is the site's own page (an https URL on one of its hostnames),
 * linked at the bottom when given.
 */
export function renderWidgetHtml(summary: PublicSummary, pageUrl: string | null): string {
  const e = escapeHtml;
  const parts: string[] = [];
  parts.push('<div class="uw-head">', `<span class="uw-name">${e(summary.site.name)}</span>`);
  if (summary.verdict) {
    const state = verdictPublicState(summary.verdict.state);
    parts.push(`<span class="uw-verdict uw-s-${state}">${e(summary.verdict.label)}</span>`);
  }
  parts.push("</div>");
  for (const section of summary.sections ?? []) {
    parts.push(`<div class="uw-sec">${e(section.title)}</div><ul>`);
    for (const s of section.services) {
      const meta = [STATE_LABEL[s.state], ...(s.uptime90d !== undefined ? [formatUptime(s.uptime90d)] : [])];
      parts.push(
        `<li class="uw-svc"><span class="uw-dot uw-s-${s.state}" aria-hidden="true"></span>`,
        `<span class="uw-label">${e(s.name ?? s.id)}</span>`,
        `<span class="uw-meta uw-s-${s.state}">${e(meta.join(" · "))}</span></li>`,
      );
    }
    parts.push("</ul>");
  }
  if (pageUrl) {
    parts.push(
      `<a class="uw-link" href="${e(pageUrl)}" target="_blank" rel="noopener noreferrer">Full status page</a>`,
    );
  }
  const title = `${summary.site.name} status`;
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="robots" content="noindex">',
    `<title>${e(title)}</title>`,
    `<style>html,body{margin:0;padding:0;background:transparent}\n${WIDGET_CSS}\n.uptellis-w{max-width:none}</style>`,
    `</head><body><div class="uptellis-w">${parts.join("")}</div></body></html>`,
  ].join("\n");
}

/**
 * `GET /embed.js`. Plain ES2017 in a string (it runs on other people's pages, so it is not bundled): it reads
 * its own origin from `document.currentScript` for `data-uptellis-base`'s default, validates the slug and
 * the base, fetches `summary.json` without credentials and draws with `createElement` and `textContent`.
 */
export const EMBED_SCRIPT = `/* Uptellis status widget: <div data-uptellis="<site>"></div> <script src="<origin>/embed.js" async></script> */
(function () {
  "use strict";
  var CSS = ${JSON.stringify(WIDGET_CSS)};
  var LABEL = ${JSON.stringify(STATE_LABEL)};
  var VERDICT = { operational: "up", degraded: "degraded", outage: "down", maintenance: "maintenance", stale: "stale", empty: "unknown" };
  var REFRESH_MS = ${REFRESH_MS};
  var SLUG = /^[a-z0-9-]{2,32}$/;
  var doc = document;
  var script = doc.currentScript;
  var ownOrigin = "";
  try {
    if (script && script.src) ownOrigin = new URL(script.src, doc.baseURI).origin;
  } catch (e) {}

  function el(tag, cls, text) {
    var node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function stateOf(s) {
    return Object.prototype.hasOwnProperty.call(LABEL, s) ? s : "unknown";
  }
  function uptime(u) {
    if (typeof u !== "number" || !isFinite(u)) return "no data";
    var pct = Math.floor(Math.min(1, Math.max(0, u)) * 10000) / 100;
    return pct.toFixed(2).replace(/\\.?0+$/, "") + "%";
  }
  function ensureStyle() {
    if (doc.getElementById("uptellis-widget-css")) return;
    var style = el("style");
    style.id = "uptellis-widget-css";
    style.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(style);
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function build(summary) {
    var box = el("div", "uptellis-w");
    var head = el("div", "uw-head");
    head.appendChild(el("span", "uw-name", summary.site && summary.site.name));
    if (summary.verdict) {
      var vs = stateOf(VERDICT[summary.verdict.state]);
      head.appendChild(el("span", "uw-verdict uw-s-" + vs, summary.verdict.label));
    }
    box.appendChild(head);
    var sections = Array.isArray(summary.sections) ? summary.sections : [];
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      box.appendChild(el("div", "uw-sec", section.title));
      var list = el("ul");
      var services = Array.isArray(section.services) ? section.services : [];
      for (var j = 0; j < services.length; j++) {
        var s = services[j];
        var st = stateOf(s.state);
        var item = el("li", "uw-svc");
        var dot = el("span", "uw-dot uw-s-" + st);
        dot.setAttribute("aria-hidden", "true");
        item.appendChild(dot);
        item.appendChild(el("span", "uw-label", s.name || s.id));
        var meta = LABEL[st];
        if (s.uptime90d !== undefined) meta += " \\u00b7 " + uptime(s.uptime90d);
        item.appendChild(el("span", "uw-meta uw-s-" + st, meta));
        list.appendChild(item);
      }
      box.appendChild(list);
    }
    return box;
  }
  function unavailable(root) {
    if (root.getAttribute("data-uptellis-state") === "ok") return;
    clear(root);
    var box = el("div", "uptellis-w");
    box.appendChild(el("span", "uw-muted", "Status unavailable"));
    root.appendChild(box);
    root.setAttribute("data-uptellis-state", "error");
  }
  function load(root) {
    var slug = root.getAttribute("data-uptellis") || "";
    var base = root.getAttribute("data-uptellis-base") || ownOrigin;
    var url;
    try {
      if (!SLUG.test(slug)) throw new Error("slug");
      var origin = new URL(base);
      if (origin.protocol !== "https:" && origin.protocol !== "http:") throw new Error("base");
      url = new URL("/api/public/" + slug + "/summary.json", origin.origin).href;
    } catch (e) {
      unavailable(root);
      return;
    }
    fetch(url, { credentials: "omit", mode: "cors" })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (summary) {
        if (!summary || summary.v !== 1) return unavailable(root);
        ensureStyle();
        clear(root);
        root.appendChild(build(summary));
        root.setAttribute("data-uptellis-state", "ok");
      })
      .catch(function () {
        unavailable(root);
      });
  }
  function start() {
    var roots = doc.querySelectorAll("div[data-uptellis]");
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      if (root.getAttribute("data-uptellis-bound") === "1") continue;
      root.setAttribute("data-uptellis-bound", "1");
      load(root);
      setInterval(load.bind(null, root), REFRESH_MS);
    }
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start);
  else start();
})();
`;
