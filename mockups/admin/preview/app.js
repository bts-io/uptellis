/* Uptellis admin mock-up, direction "preview". Vanilla JS, hash routes, one live preview of the public page. */
(function () {
  "use strict";

  var DEMO = window.UPTELLIS_DEMO;
  var V = DEMO.incident;
  var NOW = Date.parse(V.now);

  /* ---------- Helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function icon(id, cls) { return '<svg class="i ' + (cls || "") + '" aria-hidden="true"><use href="#i-' + id + '"/></svg>'; }
  function pct(x, digits) {
    if (x == null) return "No data";
    var d = digits == null ? 2 : digits;
    var v = x * 100;
    return (v >= 99.995 ? "100" : v.toFixed(d)) + "%";
  }
  function ago(ts) {
    if (!ts) return "Never";
    var s = Math.max(0, Math.round((NOW - Date.parse(ts)) / 1000));
    if (s < 60) return s + " s ago";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + " h ago";
    return Math.round(s / 86400) + " d ago";
  }
  function dur(sec) {
    if (sec < 3600) return Math.round(sec / 60) + " min";
    var h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return h + " h" + (m ? " " + m + " min" : "");
  }
  function dayLabel(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) + ", " +
      d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  }
  function timeOnly(ts) {
    return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" });
  }
  var STATE_WORD = { up: "Up", down: "Down", degraded: "Degraded", pending: "Pending", paused: "Paused", unknown: "Unknown", late: "Late", waiting: "Waiting" };
  var STATE_ICON = { up: "check", down: "down", degraded: "warn", pending: "clock", paused: "pause", unknown: "clock", late: "down", waiting: "clock" };
  function stateCls(st) { return st === "late" ? "down" : st === "waiting" ? "pending" : st; }
  function badge(st) {
    return '<span class="state state-' + stateCls(st) + '"><span class="dot">' + icon(STATE_ICON[st] || "clock") + "</span>" + (STATE_WORD[st] || st) + "</span>";
  }
  function strip(beats, cls) {
    var h = '<div class="' + (cls || "strip") + '" aria-hidden="true">';
    for (var i = 0; i < beats.length; i++) {
      var b = beats[i];
      h += '<i class="' + (b === "down" ? "b-down" : b === "degraded" ? "b-degraded" : b ? "" : "b-none") + '"></i>';
    }
    return h + "</div>";
  }
  function avgUptime(beatsFull) {
    var n = 0, t = 0;
    beatsFull.forEach(function (b) { if (typeof b.uptime === "number") { n++; t += b.uptime; } });
    return n ? t / n : null;
  }
  function seeded(seed) {
    var x = seed || 7;
    return function () { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; };
  }
  var TYPE_WORD = { http: "HTTP", port: "TCP port", tcp: "TCP port", ping: "Ping", tls: "TLS certificate", heartbeat: "Heartbeat" };

  /* ---------- Data: monitors from the real view, the rest invented ---------- */
  var MONITORS = [];
  function addService(s, group) {
    var full = s.beats90d || [];
    MONITORS.push({
      kind: "monitor", ref: s.id, name: s.name, target: s.targetDisplay, type: s.kind, state: s.state,
      latency: s.latencyMs, avg: s.avgLatencyMs, u24: s.uptime24h, u30: s.uptime30d,
      u7: avgUptime(full.slice(-7)), u90: avgUptime(full), beats: full.map(function (b) { return b.worst; }),
      recent: s.recent || [], spark: s.spark || [], interval: s.intervalS || 60, cert: s.cert, group: group,
    });
  }
  V.sections.forEach(function (sec) { sec.services.forEach(function (s) { addService(s, sec.title); }); });
  (V.unsectioned || []).forEach(function (s) { addService(s, null); });
  function mon(name) { return MONITORS.filter(function (m) { return m.name === name; })[0]; }

  function hbBeats(seed, bad) {
    var r = seeded(seed), a = [];
    for (var i = 0; i < 90; i++) a.push(r() < bad ? "down" : "up");
    return a;
  }
  var HEARTBEATS = [
    { kind: "heartbeat", name: "Nightly backup", every: "24 hours", grace: "30 minutes", last: "2026-09-27T02:04:00Z", state: "up", beats: hbBeats(11, 0.01), u30: 1 },
    { kind: "heartbeat", name: "Invoice export", every: "1 hour", grace: "5 minutes", last: "2026-09-27T23:46:00Z", state: "up", beats: hbBeats(23, 0.02), u30: 0.9986 },
    { kind: "heartbeat", name: "Cache warmer", every: "5 minutes", grace: "2 minutes", last: "2026-09-27T23:39:00Z", state: "late", beats: hbBeats(5, 0.04).slice(0, 89).concat(["down"]), u30: 0.9912 },
    { kind: "heartbeat", name: "Weekly report", every: "7 days", grace: "1 hour", last: null, state: "waiting", beats: new Array(90).fill(null), u30: null },
  ];
  function hb(name) { return HEARTBEATS.filter(function (h) { return h.name === name; })[0]; }

  var CHANNEL_TYPES = [
    { type: "email", label: "Email", icon: "mail", field: "Email address", ph: "you@example.com", input: "email" },
    { type: "discord", label: "Discord", icon: "chat", field: "Discord webhook URL", ph: "Paste the webhook URL from channel settings", input: "url" },
    { type: "slack", label: "Slack", icon: "hash", field: "Slack webhook URL", ph: "Paste the incoming webhook URL", input: "url" },
    { type: "telegram", label: "Telegram", icon: "plane", field: "Telegram chat ID", ph: "For example -1001234567890", input: "text" },
    { type: "sms", label: "SMS", icon: "phone", field: "Phone number", ph: "+1 555 0100", input: "tel" },
    { type: "webhook", label: "Webhook", icon: "hook", field: "Webhook URL", ph: "https://example.org/hooks/uptellis", input: "url" },
    { type: "ntfy", label: "ntfy", icon: "ntfy", field: "ntfy topic", ph: "acme-alerts", input: "text" },
  ];
  function ctype(t) { return CHANNEL_TYPES.filter(function (c) { return c.type === t; })[0]; }
  var CHANNELS = [
    { type: "email", name: "On-call inbox", dest: "oncall@example.com", events: ["Down", "Back up"], last: "Sent 6 min ago" },
    { type: "discord", name: "#incidents", dest: "Discord webhook, ends in ...Q7x", events: ["Down", "Back up", "Source silent", "Source back"], last: "Sent 6 min ago" },
    { type: "slack", name: "#platform", dest: "Slack webhook, ends in ...m2Pa", events: ["Down", "Back up"], last: "Sent 6 min ago" },
    { type: "telegram", name: "Ops group", dest: "Chat -1001234567890", events: ["Down", "Back up"], last: "Sent 12 d ago" },
    { type: "sms", name: "Maya's phone", dest: "+1 555 0100", events: ["Down"], last: "Sent 6 min ago" },
    { type: "webhook", name: "Incident bot", dest: "example.org/hooks/uptellis (signed)", events: ["Down", "Back up", "Source silent", "Source back"], last: "Sent 6 min ago" },
  ];

  var THEMES = [
    { id: "a", name: "sys.status", sw: ["#1d1d27", "#22222e", "#3ddc84", "#3fe3f5", "#ff6b6b"] },
    { id: "b", name: "Control Room", sw: ["#0a0c10", "#12151c", "#3ddc84", "#00e5ff", "#ff6b6b"] },
    { id: "c", name: "Session", sw: ["#050807", "#0b100e", "#3ddc84", "#00e5ff", "#ff6b6b"] },
    { id: "d", name: "Classic", sw: ["#f6f7f9", "#ffffff", "#1f9d57", "#3a74d8", "#d93f3f"] },
    { id: "e", name: "Editorial", sw: ["#fbf8f3", "#f3eee5", "#1d6b43", "#1c1a17", "#b0261d"] },
    { id: "f", name: "Dashboard", sw: ["#f3f5f9", "#ffffff", "#16a34a", "#4f46e5", "#e5484d"] },
    { id: "g", name: "Wallboard", sw: ["#07090d", "#11151c", "#34e08a", "#6fb6ff", "#ff4b55"] },
    { id: "h", name: "Friendly", sw: ["#fff8f1", "#ffffff", "#17643d", "#7a5cf0", "#a0202e"] },
    { id: "i", name: "Minimal", sw: ["#ffffff", "#ececef", "#1a9a52", "#3b73d6", "#dc3b3b"] },
  ];

  /* ---------- Mutable app state ---------- */
  var PUBLIC_NAME = { "API health": "Public API", "Web app": "Dashboard", "Primary Postgres": "Database", "Replica Postgres": "Database replica", "Primary SSH": "Primary host", "Replica SSH": "Replica host", "Runner ping": "Build runners" };
  var S = {
    theme: "d",
    siteName: V.site.name,
    host: (V.site.hostnames && V.site.hostnames[0]) || "status.example.com",
    visibility: "public",
    page: [],
    detail: "API health",
    draft: null,
    onb: { url: "https://shop.example.com", channel: "email", dest: "", sent: false },
    hbDraft: { name: "Nightly backup", every: 24, unit: "hours", grace: 30, gunit: "minutes" },
  };
  V.sections.forEach(function (sec) {
    var items = [];
    sec.services.forEach(function (s) {
      if (s.name === "Runner SSH") return; // left off the page so the picker has something to offer
      items.push({ res: mon(s.name), pub: PUBLIC_NAME[s.name] || s.name });
    });
    S.page.push({ title: sec.title === "Database" ? "Data" : sec.title, items: items });
  });
  S.page.push({ title: "Scheduled jobs", items: [{ res: hb("Nightly backup"), pub: "Nightly backups" }, { res: hb("Invoice export"), pub: "Invoice delivery" }] });

  function onPage(res) {
    for (var s = 0; s < S.page.length; s++)
      for (var i = 0; i < S.page[s].items.length; i++) if (S.page[s].items[i].res === res) return S.page[s];
    return null;
  }
  function pubName(res) {
    for (var s = 0; s < S.page.length; s++)
      for (var i = 0; i < S.page[s].items.length; i++) if (S.page[s].items[i].res === res) return S.page[s].items[i].pub;
    return null;
  }

  /* ---------- Preview (the public page, simplified) ---------- */
  var PV_STATE = { up: "Operational", down: "Down", degraded: "Degraded", pending: "Pending", paused: "Paused", late: "Down", waiting: "Pending", unknown: "Pending" };
  function pvState(st) { return st === "late" ? "down" : st === "waiting" || st === "unknown" ? "pending" : st; }

  function pvModel() {
    var screen = currentScreen();
    var m = { theme: S.theme, empty: false, sections: [], note: "", highlight: null };
    if (screen === "monitors-empty") { m.empty = true; m.note = "Nothing to show yet. Monitors you add appear here."; return m; }
    if (screen === "first-run") {
      var u = parseTarget(S.onb.url);
      if (!u.host) { m.empty = true; m.note = "Type a URL and your page appears here."; return m; }
      m.sections = [{ title: "Services", items: [{ name: nameFromHost(u), state: "pending", beats: new Array(90).fill(null), isNew: true }] }];
      m.note = "Your page, with the one monitor you are adding.";
      return m;
    }
    S.page.forEach(function (sec, si) {
      m.sections.push({
        title: sec.title, si: si,
        items: sec.items.map(function (it, ii) {
          var st = it.res.state;
          return { name: it.pub || it.res.name, state: st, beats: it.res.beats, u90: it.res.u90 != null ? it.res.u90 : it.res.u30, si: si, ii: ii, hl: screen === "monitor" && it.res.name === S.detail };
        }),
      });
    });
    var d = S.draft;
    if ((screen === "create-monitor" || screen === "monitor-pending") && d && d.show && d.name) {
      var tgt = m.sections.filter(function (x) { return x.title === d.section; })[0] || m.sections[0];
      if (tgt) tgt.items.push({ name: d.pub || d.name, state: "pending", beats: new Array(90).fill(null), isNew: true });
      m.note = screen === "create-monitor" ? "The new monitor shows as pending until its first check." : "Shown as pending until the first check comes in.";
    } else if (screen === "create-heartbeat") {
      m.sections.push({ title: "Scheduled jobs (new)", items: [{ name: S.hbDraft.name || "New heartbeat", state: "waiting", beats: new Array(90).fill(null), isNew: true }] });
      m.note = "Heartbeats can go on the page too. This one waits for its first ping.";
    } else if (screen === "status-page") {
      m.editable = true;
      m.note = "Drag rows to reorder. Click a name to rename it.";
    } else if (screen === "monitor") {
      m.note = "This monitor is shown on the page as “" + (pubName(mon(S.detail)) || S.detail) + "”.";
    } else {
      m.note = "What visitors see at " + S.host + ".";
    }
    return m;
  }

  function verdictOf(sections) {
    var all = [];
    sections.forEach(function (s) { s.items.forEach(function (i) { all.push(pvState(i.state)); }); });
    var down = all.filter(function (x) { return x === "down"; }).length;
    var deg = all.filter(function (x) { return x === "degraded"; }).length;
    var pend = all.filter(function (x) { return x === "pending"; }).length;
    if (!all.length) return { cls: "pending", label: "No services yet", sub: "" };
    if (down) return { cls: "down", label: down === 1 ? "1 service down" : down + " services down", sub: "We are looking into it." };
    if (deg) return { cls: "degraded", label: "Degraded performance", sub: "" };
    if (pend === all.length) return { cls: "pending", label: "Waiting for the first check", sub: "Status appears within a minute." };
    return { cls: "up", label: "All systems operational", sub: "" };
  }

  function renderPreview(el, forSheet) {
    var m = pvModel();
    var h = '<div class="pv' + (m.editable && !forSheet ? " is-editable" : "") + '" data-pt="' + m.theme + '">';
    h += '<div class="pv-top"><div class="pv-site"><span class="pv-mark" aria-hidden="true"></span><h3>' + esc(S.siteName) + '</h3></div><span class="pv-host">' + esc(S.host) + "</span></div>";
    if (m.empty) {
      h += '<div class="pv-empty"><div class="pv-empty-bars" aria-hidden="true"><i></i><i></i><i></i></div><p>Your status page is empty.</p><p>Add a monitor and it shows up here.</p></div>';
    } else {
      var v = verdictOf(m.sections);
      h += '<div class="pv-verdict v-' + v.cls + '"><span class="pv-vdot">' + icon(v.cls === "up" ? "check" : v.cls === "pending" ? "clock" : v.cls === "degraded" ? "warn" : "down") + '</span><div><strong>' + esc(v.label) + "</strong>" + (v.sub ? '<div class="pv-sub">' + esc(v.sub) + "</div>" : "") + "</div></div>";
      var downItems = [];
      m.sections.forEach(function (s) { s.items.forEach(function (i) { if (pvState(i.state) === "down") downItems.push(i.name); }); });
      if (downItems.length) h += '<p class="pv-inc"><b>Investigating</b><span>' + esc(downItems.join(", ")) + (downItems.length === 1 ? " is" : " are") + " not responding.</span></p>";
      m.sections.forEach(function (s) {
        h += '<section class="pv-sec" aria-label="' + esc(s.title) + '"><h4>' + esc(s.title) + '</h4><ul data-pv-sec="' + (s.si == null ? "" : s.si) + '">';
        if (!s.items.length) h += '<li class="pv-svc"><span class="pv-sub" style="color:var(--p-muted)">No services in this section yet.</span></li>';
        s.items.forEach(function (it) {
          var ps = pvState(it.state);
          var drag = m.editable && !forSheet && it.si != null;
          h += '<li class="pv-svc' + (it.isNew ? " is-new" : "") + (it.hl ? " is-hl" : "") + '"' + (drag ? ' draggable="true" data-s="' + it.si + '" data-i="' + it.ii + '"' : "") + ">";
          h += '<div class="pv-svc-top">';
          h += drag ? '<button type="button" class="pv-rename" data-rename="' + it.si + ":" + it.ii + '" title="Rename">' + esc(it.name) + "</button>" : '<span class="pv-svc-name">' + esc(it.name) + "</span>";
          h += '<span class="pv-svc-state pv-' + ps + '">' + icon(STATE_ICON[ps] || "clock") + PV_STATE[it.state] + "</span></div>";
          h += strip(it.beats, "pv-strip" + (ps === "pending" ? " is-pending" : ""));
          h += '<div class="pv-strip-legend"><span>90 days ago</span><span>' + (ps === "pending" ? "No history yet" : pct(it.u90, 2) + " uptime") + "</span><span>Today</span></div>";
          h += "</li>";
        });
        h += "</ul></section>";
      });
    }
    h += '<p class="pv-foot">Powered by Uptellis</p></div>';
    el.innerHTML = h;
  }

  function renderPreviews() {
    var screen = currentScreen();
    renderPreview($("#pv"), false);
    var m = pvModel();
    $("#pv-note").textContent = m.note;
    $("#sheet-note").textContent = m.note;
    if ($("#sheet").open) renderPreview($("#pv-sheet"), true);
    $$("[data-theme-select]").forEach(function (s) { s.value = S.theme; });
    if (screen === "status-page") wirePreviewEditing();
  }

  /* ---------- Target parsing (create monitor, first run) ---------- */
  function parseTarget(raw) {
    var v = String(raw || "").trim();
    if (!v) return { host: "", type: "http" };
    var scheme = (v.match(/^([a-z]+):\/\//i) || [])[1];
    var rest = v.replace(/^[a-z]+:\/\//i, "");
    var hostPort = rest.split(/[/?#]/)[0];
    var path = rest.slice(hostPort.length).split(/[?#]/)[0];
    var host = hostPort.replace(/:\d+$/, "");
    var port = (hostPort.match(/:(\d+)$/) || [])[1];
    var type = "http";
    if (scheme && /^https?$/i.test(scheme)) type = "http";
    else if (scheme === "tcp") type = "tcp";
    else if (scheme === "tls") type = "tls";
    else if (scheme === "ping" || scheme === "icmp") type = "ping";
    else if (port && port !== "80" && port !== "443") type = "tcp";
    else if (port === "443" && !path) type = "tls";
    else if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !path) type = "ping";
    return { host: host, port: port, path: path, type: type, scheme: scheme };
  }
  function nameFromHost(u) {
    var h = (u.host || "").replace(/^www\./, "");
    var p = (u.path || "").replace(/\/$/, "");
    return h ? h + (p && p.length < 24 ? p : "") : "";
  }

  /* ---------- Screens ---------- */
  var SCREENS = {};
  var CRUMB = {
    "first-run": "Setup", monitors: "Monitors", "monitors-empty": "Monitors", "create-monitor": "Monitors / New monitor",
    monitor: "Monitors / ", "monitor-pending": "Monitors / ", heartbeats: "Heartbeats", "create-heartbeat": "Heartbeats / New heartbeat",
    "status-page": "Status page", alerts: "Alerts", settings: "Settings", incidents: "Incidents",
  };
  var NAV_OF = { "monitors-empty": "monitors", "create-monitor": "monitors", monitor: "monitors", "monitor-pending": "monitors", "create-heartbeat": "heartbeats" };

  function checklist(doneCount) {
    var items = [
      ["Watch your first URL", "#create-monitor"],
      ["Get a test alert", "#alerts"],
      ["Arrange your status page", "#status-page"],
      ["Pick a theme", "#status-page"],
      ["Invite a teammate", "#settings"],
    ];
    var h = '<ol class="checklist">';
    items.forEach(function (it, i) {
      var done = i < doneCount;
      h += '<li class="check-item' + (done ? " done" : "") + '"><span class="check-box">' + (done ? icon("check") : "") + '</span><span class="check-text">' + it[0] + (done ? '<span class="sr-only"> (done)</span>' : "") + "</span>" + (done ? "" : '<a class="btn btn-sm" href="' + it[1] + '">' + (i === doneCount ? "Start" : "Open") + "</a>") + "</li>";
    });
    return h + "</ol>";
  }

  SCREENS["first-run"] = function () {
    var ch = ctype(S.onb.channel);
    var h = '<div class="onb">';
    h += '<div class="onb-brand"><svg class="i logo" aria-hidden="true"><use href="#i-logo"/></svg>Uptellis</div>';
    h += '<h1>What should we watch?</h1><p class="onb-lede">Give us one address and one place to tell you when it breaks. You can add everything else later.</p>';
    h += '<form class="card form-card" style="margin-top:24px" id="onb-form" novalidate>';
    h += '<div class="onb-step"><div class="onb-step-head"><span class="step-num">1</span><label class="label" for="onb-url">URL to monitor</label></div>';
    h += '<input class="input input-lg" id="onb-url" type="url" inputmode="url" autocomplete="url" placeholder="https://example.com" value="' + esc(S.onb.url) + '">';
    h += '<p class="hint" id="onb-url-hint"></p></div>';
    h += '<fieldset class="onb-step"><legend class="onb-step-head"><span class="step-num">2</span><span class="label">Where should we alert you?</span></legend><div class="chan-grid">';
    CHANNEL_TYPES.forEach(function (c) {
      h += '<label class="chan-opt"><input type="radio" name="onb-ch" value="' + c.type + '"' + (c.type === S.onb.channel ? " checked" : "") + "><span>" + icon(c.icon) + c.label + "</span></label>";
    });
    h += '</div><div class="field"><label for="onb-dest">' + ch.field + '</label><input class="input" id="onb-dest" type="' + ch.input + '" placeholder="' + esc(ch.ph) + '" value="' + esc(S.onb.dest) + '"></div></fieldset>';
    h += '<div class="form-foot"><button type="button" class="btn btn-primary btn-lg" id="onb-test">' + icon("send") + 'Send a test alert</button><span class="hint">We check every minute from the Cloudflare edge. Change it any time.</span></div>';
    h += '<div id="onb-result" aria-live="polite"></div>';
    h += "</form>";
    h += '<section class="card" style="margin-top:20px" aria-labelledby="onb-next"><div class="card-head"><h2 id="onb-next">Then, when you have a minute</h2><p>' + (S.onb.sent ? "2" : "1") + ' of 5 done</p></div><div class="card-pad" style="padding-top:8px;padding-bottom:8px">' + checklist(S.onb.sent ? 2 : 1) + "</div></section>";
    h += '<p class="hint" style="margin-top:16px;text-align:center"><a href="#monitors-empty">Skip setup</a></p>';
    h += "</div>";
    return h;
  };

  function onbResult() {
    var ch = ctype(S.onb.channel);
    var dest = S.onb.dest || ch.ph;
    if (!S.onb.sent) return "";
    return '<div class="notice notice-ok">' + icon("check") + '<div class="stack-sm" style="gap:8px"><p><strong>Test alert sent to ' + esc(ch.label) + '.</strong> It went to ' + esc(dest) + '. Did it arrive?</p><div class="row"><a class="btn btn-primary btn-sm" href="#monitors">Yes, start monitoring</a><button type="button" class="btn btn-sm" id="onb-retry">No, send it again</button></div></div></div>';
  }

  function wireFirstRun() {
    var url = $("#onb-url");
    function hint() {
      var u = parseTarget(url.value);
      $("#onb-url-hint").textContent = u.host ? "We will check " + TYPE_WORD[u.type] + " on " + u.host + " and call it “" + nameFromHost(u) + "”." : "Paste a website, API endpoint or host.";
    }
    hint();
    url.addEventListener("input", function () { S.onb.url = url.value; hint(); renderPreviews(); });
    $$('input[name="onb-ch"]').forEach(function (r) {
      r.addEventListener("change", function () { S.onb.channel = r.value; S.onb.dest = ""; S.onb.sent = false; route(true); $('input[name="onb-ch"][value="' + r.value + '"]').focus(); });
    });
    $("#onb-dest").addEventListener("input", function (e) { S.onb.dest = e.target.value; });
    function send() { S.onb.sent = true; $("#onb-result").innerHTML = onbResult(); var r = $("#onb-retry"); if (r) r.addEventListener("click", send); announce("Test alert sent"); }
    $("#onb-test").addEventListener("click", send);
    if (S.onb.sent) send();
  }

  function monRows(list) {
    var h = '<div class="list"><div class="list-head" aria-hidden="true"><span>State</span><span>Name</span><span>Last 90 days</span><span>Uptime 30 d</span><span>Last check</span><span></span></div><ul>';
    list.forEach(function (m) {
      var last = m.recent[0] && m.recent[0].ts;
      h += '<li><a class="mon-row" href="#monitor" data-detail="' + esc(m.name) + '">';
      h += '<span class="c-state">' + badge(m.state) + "</span>";
      h += '<span class="c-name mon-name"><strong>' + esc(m.name) + '</strong><span class="mono">' + esc(TYPE_WORD[m.type] || m.type) + " · " + esc(m.target) + "</span></span>";
      h += '<span class="c-strip">' + strip(m.beats) + "</span>";
      h += '<span class="c-up num"><span class="cell-label">Uptime 30 d </span>' + pct(m.u30) + "</span>";
      h += '<span class="c-last num muted small">' + ago(last) + "</span>";
      h += icon("chev", "chev") + "</a></li>";
    });
    return h + "</ul></div>";
  }

  SCREENS.monitors = function () {
    var down = MONITORS.filter(function (m) { return m.state === "down"; }).length;
    var h = '<div class="page-head"><div><h1>Monitors</h1><p>' + MONITORS.length + " monitors" + (down ? ", " + down + " down" : ", all up") + '. Checked from the Cloudflare edge.</p></div><div class="row"><a class="btn btn-primary" href="#create-monitor">' + icon("plus") + "New monitor</a></div></div>";
    h += '<div class="stack">';
    h += '<section class="card" aria-labelledby="gs-title"><div class="card-head"><div><h2 id="gs-title">Getting started</h2><p>3 of 5 done</p></div><button type="button" class="btn btn-ghost btn-sm">Hide</button></div><div class="card-pad" style="padding-top:12px;padding-bottom:10px"><div class="progress" aria-hidden="true"><span style="width:60%"></span></div>' + checklist(3) + "</div></section>";
    h += '<section aria-labelledby="all-mon"><h2 id="all-mon" class="sr-only">All monitors</h2><div class="toolbar"><div class="search">' + icon("search") + '<label class="sr-only" for="mon-q">Search monitors</label><input class="input" id="mon-q" type="search" placeholder="Search by name or address"></div><label class="sr-only" for="mon-f">Show</label><select class="select" id="mon-f" style="width:auto"><option value="">All states</option><option value="down">Down</option><option value="up">Up</option></select></div><div id="mon-list">' + monRows(MONITORS) + "</div></section>";
    h += "</div>";
    return h;
  };
  function wireMonitors() {
    function apply() {
      var q = $("#mon-q").value.toLowerCase(), f = $("#mon-f").value;
      var list = MONITORS.filter(function (m) { return (!f || m.state === f) && (m.name + " " + m.target).toLowerCase().indexOf(q) >= 0; });
      $("#mon-list").innerHTML = list.length ? monRows(list) : '<div class="card empty"><p>No monitors match that search.</p></div>';
    }
    $("#mon-q").addEventListener("input", apply);
    $("#mon-f").addEventListener("change", apply);
  }

  SCREENS["monitors-empty"] = function () {
    return '<div class="page-head"><div><h1>Monitors</h1></div></div><div class="card empty"><div class="empty-art">' + icon("monitor") + '</div><p>Add a URL and Uptellis checks it every minute.</p><a class="btn btn-primary btn-lg" href="#create-monitor">' + icon("plus") + "Add your first monitor</a></div>";
  };

  SCREENS["create-monitor"] = function () {
    var d = S.draft || (S.draft = { url: "https://example.com/billing/health", type: null, name: "", nameTouched: false, pub: "", section: "Web", show: true });
    var sections = S.page.map(function (s) { return '<option' + (s.title === d.section ? " selected" : "") + ">" + esc(s.title) + "</option>"; }).join("");
    var h = '<div class="page-head"><div><h1>New monitor</h1><p>Paste an address. We fill in the rest; change anything you like.</p></div></div>';
    h += '<form class="stack" id="cm-form" novalidate><div class="card form-card">';
    h += '<div class="field"><label for="cm-url">URL or host</label><input class="input input-lg" id="cm-url" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://example.com or db.example.com:5432" value="' + esc(d.url) + '"></div>';
    h += '<fieldset><legend>Check type <span class="muted" style="font-weight:400" id="cm-detected"></span></legend><div class="seg" id="cm-type">';
    [["http", "HTTP"], ["tcp", "TCP port"], ["ping", "Ping"], ["tls", "TLS certificate"]].forEach(function (t) {
      h += '<label><input type="radio" name="cm-type" value="' + t[0] + '"><span>' + t[1] + "</span></label>";
    });
    h += "</div></fieldset>";
    h += '<div class="field"><label for="cm-name">Name</label><input class="input" id="cm-name" type="text" value=""><p class="hint">Taken from the address until you change it. Only you see this name.</p></div>';
    h += '<div class="defaults">';
    h += '<div class="default-tile"><label class="label" for="cm-int">Check</label><select class="select" id="cm-int"><option>Every 30 seconds</option><option selected>Every minute</option><option>Every 5 minutes</option><option>Every 15 minutes</option></select></div>';
    h += '<div class="default-tile"><label class="label" for="cm-alert">Alert</label><select class="select" id="cm-alert"><option selected>All channels (' + CHANNELS.length + ')</option>' + CHANNELS.map(function (c) { return "<option>" + esc(ctype(c.type).label + ": " + c.name) + "</option>"; }).join("") + "<option>No alerts</option></select></div>";
    h += '<div class="default-tile"><label class="label" for="cm-sec">Status page section</label><select class="select" id="cm-sec">' + sections + '<option value="">Do not show</option></select></div>';
    h += "</div>";
    h += '<div class="field"><label for="cm-pub">Public name on the status page</label><input class="input" id="cm-pub" type="text" placeholder="Same as the name"><p class="hint">What visitors read, for example “Checkout” instead of a hostname.</p></div>';
    h += "</div>";
    h += '<details class="adv" id="cm-adv"><summary>' + icon("chev", "chev") + 'Advanced settings<span class="hint" id="cm-adv-sum"></span></summary><div class="adv-body">';
    h += '<div class="grid-3" data-for="http"><div class="field"><label for="cm-method">Method</label><select class="select" id="cm-method"><option>GET</option><option>HEAD</option><option>POST</option></select></div><div class="field"><label for="cm-status">Expected status</label><input class="input" id="cm-status" value="200-299"></div><div class="field"><label for="cm-kw">Page must contain</label><input class="input" id="cm-kw" placeholder="Optional keyword"></div></div>';
    h += '<div class="grid-3" data-for="tls" hidden><div class="field"><label for="cm-tlsdays">Warn before expiry</label><select class="select" id="cm-tlsdays"><option>14 days</option><option selected>21 days</option><option>30 days</option></select></div></div>';
    h += '<div class="grid-3"><div class="field"><label for="cm-timeout">Timeout</label><select class="select" id="cm-timeout"><option>5 seconds</option><option selected>10 seconds</option><option>30 seconds</option></select></div><div class="field"><label for="cm-retries">Retries before down</label><select class="select" id="cm-retries"><option>0</option><option selected>1</option><option>2</option><option>3</option></select></div><div class="field"><label for="cm-quorum">Down when</label><select class="select" id="cm-quorum"><option>Any location fails</option><option selected>2 of 3 locations fail</option><option>All locations fail</option></select></div></div>';
    h += '<fieldset><legend>Where it runs</legend><div class="seg"><label><input type="radio" name="cm-where" value="edge" checked><span>Cloudflare edge</span></label><label><input type="radio" name="cm-where" value="berlin"><span>Agent: berlin-runner</span></label><label><input type="radio" name="cm-where" value="office"><span>Agent: office-nas</span></label></div><p class="hint" style="margin-top:6px">Use an agent for addresses only reachable inside your network.</p></fieldset>';
    h += "</div></details>";
    h += '<div class="form-foot"><button type="button" class="btn btn-primary btn-lg" id="cm-create">Create monitor</button><a class="btn btn-ghost" href="#monitors">Cancel</a><span class="hint">First check runs right after you create it.</span></div>';
    h += "</form>";
    return h;
  };
  function wireCreateMonitor() {
    var d = S.draft;
    function sync(fromUrl) {
      var u = parseTarget($("#cm-url").value);
      d.url = $("#cm-url").value;
      if (fromUrl || !d.type) { d.type = u.type; }
      $$('input[name="cm-type"]').forEach(function (r) { r.checked = r.value === d.type; });
      $("#cm-detected").textContent = u.host ? "(detected from the address)" : "";
      if (!d.nameTouched) { d.name = nameFromHost(u); $("#cm-name").value = d.name; }
      $$("[data-for]").forEach(function (g) { g.hidden = g.getAttribute("data-for") !== d.type; });
      $("#cm-adv-sum").textContent = (d.type === "http" ? "GET, expects 200-299, " : "") + "10 s timeout, 1 retry, Cloudflare edge";
      renderPreviews();
    }
    $("#cm-url").addEventListener("input", function () { sync(true); });
    $$('input[name="cm-type"]').forEach(function (r) { r.addEventListener("change", function () { d.type = r.value; sync(false); }); });
    $("#cm-name").addEventListener("input", function (e) { d.nameTouched = true; d.name = e.target.value; renderPreviews(); });
    $("#cm-pub").addEventListener("input", function (e) { d.pub = e.target.value; renderPreviews(); });
    $("#cm-pub").value = d.pub || "";
    $("#cm-sec").addEventListener("change", function (e) { d.section = e.target.value; d.show = !!e.target.value; renderPreviews(); });
    $("#cm-create").addEventListener("click", function () { location.hash = "#monitor-pending"; });
    sync(false);
    if (d.nameTouched) $("#cm-name").value = d.name;
  }

  function chart(m) {
    var r = seeded(m.name.length * 97 + 3);
    var pts = [];
    var base = m.avg || m.latency || 300;
    for (var i = 0; i < 26; i++) pts.push(Math.round(base * (0.88 + r() * 0.24) + (i === 9 ? base * 0.9 : 0)));
    m.recent.slice().reverse().forEach(function (c) { if (c.latencyMs != null) pts.push(c.latencyMs); });
    var W = 640, H = 180, pl = 44, pr = 8, pt = 12, pb = 24;
    var max = Math.ceil(Math.max.apply(null, pts) / 100) * 100, min = 0;
    var x = function (i) { return pl + (i * (W - pl - pr)) / (pts.length - 1); };
    var y = function (v) { return pt + (1 - (v - min) / (max - min)) * (H - pt - pb); };
    var line = pts.map(function (v, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); }).join(" ");
    var area = line + " L" + x(pts.length - 1).toFixed(1) + " " + (H - pb) + " L" + pl + " " + (H - pb) + " Z";
    var avg = Math.round(pts.reduce(function (a, b) { return a + b; }, 0) / pts.length);
    var lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
    var g = "";
    [0, 0.5, 1].forEach(function (f) { var v = Math.round(min + f * (max - min)); g += '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (pl - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + " ms</text>"; });
    var svg = '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-labelledby="chart-sum">' + g + '<path class="area" d="' + area + '"/><path class="ln" d="' + line + '" vector-effect="non-scaling-stroke"/><text x="' + pl + '" y="' + (H - 6) + '">' + pts.length + ' checks ago</text><text x="' + (W - pr) + '" y="' + (H - 6) + '" text-anchor="end">Now</text></svg>';
    return { svg: svg, text: "Last " + pts.length + " checks: average " + avg + " ms, fastest " + lo + " ms, slowest " + hi + " ms." };
  }

  SCREENS.monitor = function () {
    var m = mon(S.detail) || MONITORS[0];
    var c = chart(m);
    var incs = V.incidents.open.concat(V.incidents.recent).filter(function (i) { return i.subject === m.name; });
    var sec = onPage(m);
    var h = '<div class="detail-head"><div class="detail-title"><div class="row"><span class="big-state state state-' + m.state + '"><span class="dot">' + icon(STATE_ICON[m.state]) + "</span>" + (STATE_WORD[m.state]) + (m.state === "up" ? " for 11 d" : m.state === "down" ? " for 6 min" : "") + "</span></div><h1>" + esc(m.name) + '</h1><div class="meta"><span class="mono">' + esc(m.target) + "</span><span>" + esc(TYPE_WORD[m.type] || m.type) + "</span><span>Every " + (m.interval >= 60 ? m.interval / 60 + " min" : m.interval + " s") + "</span><span>Cloudflare edge</span></div></div>";
    h += '<div class="row"><button type="button" class="btn" id="md-test">' + icon("send") + 'Send test alert</button><button type="button" class="btn" id="md-pause">' + icon("pause") + 'Pause</button><a class="btn" href="#create-monitor">' + icon("edit") + "Edit</a></div></div>";
    h += '<div id="md-msg" aria-live="polite"></div><div class="stack">';
    h += '<section class="card" aria-labelledby="md-up"><h2 id="md-up" class="sr-only">Uptime and response</h2><dl class="stats"><div class="stat"><dt>Uptime 24 h</dt><dd>' + pct(m.u24) + '</dd></div><div class="stat"><dt>Uptime 7 d</dt><dd>' + pct(m.u7) + '</dd></div><div class="stat"><dt>Uptime 30 d</dt><dd>' + pct(m.u30) + '</dd></div><div class="stat"><dt>Response now</dt><dd>' + (m.latency != null ? m.latency + " ms" : "None") + "</dd></div></dl></section>";
    h += '<section class="card" aria-labelledby="md-rt"><div class="card-head"><div><h2 id="md-rt">Response time</h2><p id="chart-sum">' + esc(c.text) + '</p></div></div><div class="card-pad" style="padding-top:12px">' + c.svg + "</div></section>";
    h += '<section class="card" aria-labelledby="md-90"><div class="card-head"><div><h2 id="md-90">Last 90 days</h2><p>' + pct(m.u90) + " uptime. Red days had downtime, amber days were slow or partly down.</p></div></div><div class=\"card-pad\">" + strip(m.beats) + "</div></section>";
    h += '<section class="card" aria-labelledby="md-checks"><div class="card-head"><h2 id="md-checks">Recent checks</h2><p>Newest first</p></div><table class="tbl"><thead><tr><th scope="col">Time</th><th scope="col">Result</th><th scope="col">Response</th><th scope="col" class="hide-sm">Message</th></tr></thead><tbody>';
    m.recent.forEach(function (r) { h += "<tr><td class=\"num\">" + timeOnly(r.ts) + " UTC</td><td>" + badge(r.status) + '</td><td class="num">' + (r.latencyMs != null ? r.latencyMs + " ms" : "None") + '</td><td class="hide-sm muted">' + esc(r.message || "") + "</td></tr>"; });
    h += "</tbody></table></section>";
    h += '<section class="card" aria-labelledby="md-inc"><div class="card-head"><h2 id="md-inc">Incidents</h2><p>Last 90 days</p></div>';
    if (incs.length) {
      h += '<table class="tbl"><thead><tr><th scope="col">Started</th><th scope="col">What happened</th><th scope="col">Lasted</th></tr></thead><tbody>';
      incs.forEach(function (i) { h += "<tr><td class=\"num\">" + dayLabel(i.startedAt) + "</td><td>" + esc(i.title) + '</td><td class="num">' + (i.endedAt ? dur(i.durationS) : "Ongoing") + "</td></tr>"; });
      h += "</tbody></table>";
    } else h += '<div class="card-pad"><p class="muted">No incidents in the last 90 days.</p></div>';
    h += "</section>";
    h += '<section class="card card-pad" aria-labelledby="md-page"><h2 id="md-page">On the status page</h2><p class="muted" style="margin:4px 0 12px">' + (sec ? "Shown in “" + esc(sec.title) + "” as “" + esc(pubName(m)) + "”." : "Not shown on the status page.") + '</p><a class="btn btn-sm" href="#status-page">Edit status page</a></section>';
    h += '<section class="card card-pad danger-zone" aria-labelledby="md-del"><h2 id="md-del">Delete monitor</h2><p class="muted" style="margin:4px 0 12px">Removes its history and takes it off the status page. This cannot be undone.</p><button type="button" class="btn btn-danger btn-sm">' + icon("trash") + "Delete " + esc(m.name) + "</button></section>";
    h += "</div>";
    return h;
  };
  function wireMonitor() {
    $("#md-test").addEventListener("click", function () { $("#md-msg").innerHTML = '<div class="notice notice-ok" style="margin-bottom:16px">' + icon("check") + "<p>Test alert sent to all " + CHANNELS.length + " channels. It is marked as a test so nobody panics.</p></div>"; });
    $("#md-pause").addEventListener("click", function (e) {
      var b = e.currentTarget, paused = b.textContent.indexOf("Resume") >= 0;
      b.innerHTML = paused ? icon("pause") + "Pause" : icon("check") + "Resume";
      $("#md-msg").innerHTML = paused ? "" : '<div class="notice notice-warn" style="margin-bottom:16px">' + icon("pause") + "<p>Paused. No checks and no alerts until you resume. The status page shows it as paused.</p></div>";
    });
  }

  SCREENS["monitor-pending"] = function () {
    var d = S.draft || (S.draft = { url: "https://example.com/billing/health", type: "http", name: "example.com/billing/health", section: "Web", show: true });
    var u = parseTarget(d.url);
    var name = d.name || nameFromHost(u) || "New monitor";
    var h = '<div class="detail-head"><div class="detail-title"><div class="row">' + '<span class="big-state state state-pending"><span class="dot">' + icon("clock") + "</span>Pending</span></div><h1>" + esc(name) + '</h1><div class="meta"><span class="mono">' + esc(d.url) + "</span><span>" + esc(TYPE_WORD[d.type] || "HTTP") + "</span><span>Every minute</span><span>Cloudflare edge</span></div></div>";
    h += '<div class="row"><button type="button" class="btn" id="mp-test">' + icon("send") + 'Send test alert</button><a class="btn" href="#create-monitor">' + icon("edit") + "Edit</a></div></div>";
    h += '<div id="mp-msg" aria-live="polite"></div>';
    h += '<section class="card pending-hero" aria-labelledby="mp-h"><div class="spinner" aria-hidden="true"></div><h2 id="mp-h" style="font-size:18px">Pending, waiting for the first check</h2><p class="muted">The first check runs within a minute. This page updates by itself.</p><ol class="steps-line">';
    h += '<li><span class="state state-up"><span class="dot">' + icon("check") + '</span></span>Monitor created</li>';
    h += '<li><span class="state state-up"><span class="dot">' + icon("check") + "</span></span>Added to the status page" + (d.show && d.section ? " in “" + esc(d.section) + "”" : "") + "</li>";
    h += '<li><span class="state state-pending"><span class="dot">' + icon("clock") + "</span></span>First check from the Cloudflare edge</li>";
    h += '<li><span class="state state-pending"><span class="dot">' + icon("clock") + "</span></span>Alerts go to all " + CHANNELS.length + " channels if it fails</li></ol></section>";
    h += '<div class="stack" style="margin-top:20px"><section class="card" aria-labelledby="mp-st"><h2 id="mp-st" class="sr-only">Uptime</h2><dl class="stats"><div class="stat"><dt>Uptime 24 h</dt><dd class="muted">None yet</dd></div><div class="stat"><dt>Uptime 7 d</dt><dd class="muted">None yet</dd></div><div class="stat"><dt>Uptime 30 d</dt><dd class="muted">None yet</dd></div><div class="stat"><dt>Response now</dt><dd class="muted">None yet</dd></div></dl></section>';
    h += '<section class="card" aria-labelledby="mp-ch"><div class="card-head"><h2 id="mp-ch">Recent checks</h2></div><div class="card-pad"><p class="muted">No checks yet. They appear here as they come in.</p></div></section></div>';
    return h;
  };
  function wireMonitorPending() {
    $("#mp-test").addEventListener("click", function () { $("#mp-msg").innerHTML = '<div class="notice notice-ok" style="margin-bottom:16px">' + icon("check") + "<p>Test alert sent to all " + CHANNELS.length + " channels.</p></div>"; });
  }

  SCREENS.heartbeats = function () {
    var h = '<div class="page-head"><div><h1>Heartbeats</h1><p>For cron jobs and workers: they ping us, and we alert you when a ping is late.</p></div><div class="row"><a class="btn btn-primary" href="#create-heartbeat">' + icon("plus") + "New heartbeat</a></div></div>";
    h += '<div class="list"><div class="list-head hb-row" aria-hidden="true"><span>State</span><span>Name</span><span>Expected</span><span>Last ping</span><span></span></div><ul>';
    HEARTBEATS.forEach(function (b) {
      h += '<li><a class="mon-row hb-row" href="#create-heartbeat"><span class="c-state">' + badge(b.state) + '</span><span class="c-name mon-name"><strong>' + esc(b.name) + '</strong><span class="small muted">' + (onPage(b) ? "On the status page" : "Not on the status page") + '</span></span><span class="c-every small">Every ' + b.every + ", grace " + b.grace + '</span><span class="c-last small num"><span class="cell-label">Last ping </span>' + (b.last ? ago(b.last) : "Never") + (b.state === "late" ? " (overdue)" : "") + "</span>" + icon("chev", "chev") + "</a></li>";
    });
    h += "</ul></div>";
    return h;
  };

  SCREENS["create-heartbeat"] = function () {
    var d = S.hbDraft;
    var url = "https://" + S.host + "/api/push/7Kq2mX9vT4pLr8Wd";
    var sel = function (id, label, val, opts) { return '<label class="sr-only" for="' + id + '">' + label + '</label><select class="select" id="' + id + '">' + opts.map(function (o) { return "<option" + (o === val ? " selected" : "") + ">" + o + "</option>"; }).join("") + "</select>"; };
    var h = '<div class="page-head"><div><h1>New heartbeat</h1><p>Your job calls a URL when it finishes. If the call does not come, we alert you.</p></div></div>';
    h += '<div class="stack"><form class="card form-card" novalidate>';
    h += '<div class="field"><label for="hb-name">Name</label><input class="input" id="hb-name" value="' + esc(d.name) + '"></div>';
    h += '<fieldset><legend>Schedule</legend><p class="sentence">Expect a heartbeat every <label class="sr-only" for="hb-every">Interval</label><input class="input num" id="hb-every" inputmode="numeric" value="' + d.every + '"> ' + sel("hb-unit", "Interval unit", d.unit, ["minutes", "hours", "days"]) + ", grace <label class=\"sr-only\" for=\"hb-grace\">Grace period</label><input class=\"input num\" id=\"hb-grace\" inputmode=\"numeric\" value=\"" + d.grace + '"> ' + sel("hb-gunit", "Grace unit", d.gunit, ["minutes", "hours"]) + '</p><p class="hint" id="hb-say" style="margin-top:8px"></p></fieldset>';
    h += '<div class="form-foot"><button type="button" class="btn btn-primary" id="hb-save">Create heartbeat</button><span class="hint">Alerts go to all channels. Change it in advanced settings.</span></div></form>';
    h += '<section class="card form-card" aria-labelledby="hb-url-h"><div class="row"><h2 id="hb-url-h">Your ping URL</h2>' + badge("waiting") + '</div>';
    h += '<div class="notice notice-warn">' + icon("warn") + "<p><strong>Shown once.</strong> Copy it now and keep it with your job. If you lose it, make a new one; the old one stops working.</p></div>";
    h += '<div class="field"><span class="label" id="hb-u-l">URL</span><div class="codebox"><code id="hb-url" aria-labelledby="hb-u-l">' + esc(url) + '</code><button type="button" class="btn" data-copy="hb-url">' + icon("copy") + "Copy</button></div></div>";
    h += '<div class="field"><span class="label" id="hb-c-l">Add this line to the end of your job</span><div class="codebox"><code id="hb-curl" aria-labelledby="hb-c-l">curl -fsS "' + esc(url) + '?status=up&amp;msg=OK"</code><button type="button" class="btn" data-copy="hb-curl">' + icon("copy") + "Copy</button></div><p class=\"hint\">Send <code>status=down</code> with a message when the job fails, and we alert straight away.</p></div>";
    h += '<div class="notice"><span class="spinner" style="width:18px;height:18px;border-width:2px;flex:none" aria-hidden="true"></span><p><strong>Waiting for the first ping.</strong> Run your job once, or paste the curl line into a terminal, to see it arrive.</p></div>';
    h += "</section></div>";
    return h;
  };
  function wireCreateHeartbeat() {
    var d = S.hbDraft;
    function say() {
      d.every = $("#hb-every").value; d.unit = $("#hb-unit").value; d.grace = $("#hb-grace").value; d.gunit = $("#hb-gunit").value; d.name = $("#hb-name").value;
      var n = parseInt(d.every, 10) || 0, g = parseInt(d.grace, 10) || 0;
      var unit = n === 1 ? d.unit.replace(/s$/, "") : d.unit, gu = g === 1 ? d.gunit.replace(/s$/, "") : d.gunit;
      $("#hb-say").textContent = "If no ping arrives within " + n + " " + unit + " and " + g + " " + gu + " of the last one, we mark it down and alert you.";
    }
    ["hb-every", "hb-unit", "hb-grace", "hb-gunit"].forEach(function (id) { $("#" + id).addEventListener("input", say); $("#" + id).addEventListener("change", say); });
    $("#hb-name").addEventListener("input", function () { say(); renderPreviews(); });
    $("#hb-save").addEventListener("click", function () { announce("Heartbeat created. Copy the URL below."); $("#hb-url-h").focus && $("#hb-url-h").setAttribute("tabindex", "-1"); $("#hb-url-h").focus(); });
    say();
  }

  SCREENS.incidents = function () {
    var h = '<div class="page-head"><div><h1>Incidents</h1><p>Opened for you when a monitor goes down. Add a note and it shows on the status page.</p></div></div><div class="stack">';
    function tbl(list, title, id) {
      var t = '<section class="card" aria-labelledby="' + id + '"><div class="card-head"><h2 id="' + id + '">' + title + "</h2></div>";
      if (!list.length) return t + '<div class="card-pad"><p class="muted">None.</p></div></section>';
      t += '<table class="tbl"><thead><tr><th scope="col">What happened</th><th scope="col">Started</th><th scope="col">Lasted</th></tr></thead><tbody>';
      list.forEach(function (i) { t += "<tr><td>" + badge(i.endedAt ? "up" : "down") + " " + esc(i.title) + '</td><td class="num">' + dayLabel(i.startedAt) + '</td><td class="num">' + (i.endedAt ? dur(i.durationS) : "Ongoing, " + dur(i.durationS)) + "</td></tr>"; });
      return t + "</tbody></table></section>";
    }
    h += tbl(V.incidents.open, "Open", "inc-open") + tbl(V.incidents.recent, "Resolved", "inc-rec");
    return h + "</div>";
  };

  /* ---------- Status page editor ---------- */
  SCREENS["status-page"] = function () {
    var h = '<div class="page-head"><div><h1>Status page</h1><p>What visitors see at <span class="mono">' + esc(S.host) + '</span>. Changes show in the preview as you make them.</p></div><div class="row"><a class="btn" href="#status-page" id="sp-view">' + icon("ext") + 'View page</a><button type="button" class="btn btn-primary" id="sp-publish">Publish changes</button></div></div>';
    h += '<div id="sp-msg" aria-live="polite"></div><div class="stack">';
    h += '<section class="card card-pad stack-sm" aria-labelledby="sp-basics"><h2 id="sp-basics">Page</h2><div class="grid-2"><div class="field"><label for="sp-title">Title</label><input class="input" id="sp-title" value="' + esc(S.siteName) + '"></div><fieldset><legend>Who can see it</legend><div class="seg">';
    [["public", "Everyone"], ["link", "Anyone with the link"], ["private", "Only signed-in users"]].forEach(function (v) { h += '<label><input type="radio" name="sp-vis" value="' + v[0] + '"' + (S.visibility === v[0] ? " checked" : "") + "><span>" + v[1] + "</span></label>"; });
    h += "</div></fieldset></div></section>";
    h += '<section class="card card-pad stack-sm" aria-labelledby="sp-theme-h"><div class="row"><h2 id="sp-theme-h">Theme</h2><span class="spacer"></span><span class="hint">Nine built-in looks. The preview switches instantly.</span></div><fieldset><legend class="sr-only">Theme</legend><div class="theme-grid">';
    THEMES.forEach(function (t) {
      h += '<label class="theme-opt"><input type="radio" name="sp-theme" value="' + t.id + '"' + (S.theme === t.id ? " checked" : "") + '><span class="card-t"><span class="theme-sw" aria-hidden="true">' + t.sw.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join("") + '</span><span class="theme-name">' + t.name + icon("check") + "</span></span></label>";
    });
    h += "</div></fieldset></section>";
    h += '<section aria-labelledby="sp-struct" class="stack-sm"><div class="row"><h2 id="sp-struct">Sections and services</h2><span class="spacer"></span><span class="hint">Drag the handles, or focus one and use the arrow keys.</span></div><div class="sp-grid" id="sp-editor"></div>';
    h += '<div class="row"><button type="button" class="btn" id="sp-addsec">' + icon("plus") + 'Add section</button></div>';
    h += '<div class="card card-pad stack-sm" id="sp-off"></div></section>';
    h += "</div>";
    return h;
  };

  function candidates() {
    return MONITORS.concat(HEARTBEATS);
  }
  function renderEditor(focusSel) {
    var ed = $("#sp-editor");
    if (!ed) return;
    var h = "";
    S.page.forEach(function (sec, si) {
      h += '<div class="sec-card" data-sec="' + si + '"><div class="sec-head">';
      h += '<button type="button" class="btn btn-icon handle" draggable="true" data-sec-handle="' + si + '" aria-label="Move section ' + esc(sec.title) + '. Use the up and down arrow keys.">' + icon("grip") + "</button>";
      h += '<label class="sr-only" for="sec-name-' + si + '">Section name</label><input class="input" id="sec-name-' + si + '" data-sec-name="' + si + '" value="' + esc(sec.title) + '">';
      h += '<span class="sec-count">' + sec.items.length + (sec.items.length === 1 ? " service" : " services") + "</span>";
      h += '<button type="button" class="btn btn-icon" data-sec-del="' + si + '" aria-label="Remove section ' + esc(sec.title) + '">' + icon("trash") + "</button></div>";
      h += '<ul class="ed-items" data-drop-sec="' + si + '">';
      if (!sec.items.length) h += '<li class="ed-empty">Empty section. Add monitors below or drag them here.</li>';
      sec.items.forEach(function (it, ii) {
        var r = it.res;
        h += '<li class="ed-item" draggable="true" data-s="' + si + '" data-i="' + ii + '">';
        h += '<button type="button" class="btn btn-icon handle" data-item-handle="' + si + ":" + ii + '" aria-label="Move ' + esc(it.pub) + '. Use the up and down arrow keys.">' + icon("grip") + "</button>";
        h += '<span class="ed-state state state-' + stateCls(r.state) + '" title="' + (STATE_WORD[r.state] || r.state) + '"><span class="dot">' + icon(STATE_ICON[r.state] || "clock") + '</span><span class="sr-only">' + (STATE_WORD[r.state] || r.state) + "</span></span>";
        h += '<span class="ed-src"><strong>' + esc(r.name) + "</strong><span>" + (r.kind === "heartbeat" ? "Heartbeat, every " + r.every : esc(TYPE_WORD[r.type] || r.type) + ", " + esc(r.target)) + "</span></span>";
        h += '<span class="ed-name"><label class="sr-only" for="pub-' + si + "-" + ii + '">Public name for ' + esc(r.name) + '</label><input class="input" id="pub-' + si + "-" + ii + '" data-pub="' + si + ":" + ii + '" value="' + esc(it.pub) + '" placeholder="' + esc(r.name) + '"></span>';
        h += '<button type="button" class="btn btn-icon ed-rm" data-rm="' + si + ":" + ii + '" aria-label="Take ' + esc(it.pub) + ' off the page">' + icon("x") + "</button></li>";
      });
      h += "</ul>";
      h += '<div class="picker"><div class="search">' + icon("search") + '<label class="sr-only" for="pk-' + si + '">Search monitors to add to ' + esc(sec.title) + '</label><input class="input" id="pk-' + si + '" data-picker="' + si + '" type="search" autocomplete="off" placeholder="Search monitors to add" aria-controls="pkl-' + si + '" aria-expanded="false"></div><div class="picker-list" id="pkl-' + si + '" hidden></div></div>';
      h += "</div>";
    });
    ed.innerHTML = h;
    var off = candidates().filter(function (r) { return !onPage(r); });
    $("#sp-off").innerHTML = '<h3>Not on the page</h3>' + (off.length ? '<p class="hint">Monitors and heartbeats you have not shown yet. Click one to add it to the last section.</p><div class="off-page">' + off.map(function (r) { return '<button type="button" class="btn btn-sm" data-quick="' + esc(r.name) + '">' + icon("plus", "i-sm") + esc(r.name) + (r.kind === "heartbeat" ? ' <span class="muted">(heartbeat)</span>' : "") + "</button>"; }).join("") + "</div>" : '<p class="hint">Everything is on the page.</p>');
    wireEditor();
    if (focusSel) { var f = $(focusSel); if (f) f.focus(); }
  }

  function pickerHTML(si, q) {
    q = (q || "").toLowerCase();
    var list = candidates().filter(function (r) { return (r.name + " " + (r.target || "")).toLowerCase().indexOf(q) >= 0; });
    if (!list.length) return '<p class="hint" style="padding:8px">Nothing matches. <a href="#create-monitor">Create a monitor</a></p>';
    var h = "";
    [["monitor", "Monitors"], ["heartbeat", "Heartbeats"]].forEach(function (g) {
      var part = list.filter(function (r) { return r.kind === g[0]; });
      if (!part.length) return;
      h += '<div class="picker-group" aria-hidden="true">' + g[1] + "</div>";
      part.forEach(function (r) {
        var where = onPage(r);
        h += '<button type="button" data-add="' + si + '" data-name="' + esc(r.name) + '"' + (where ? " disabled" : "") + ">" + badge(r.state).replace('class="state', 'class="state ed-state') + '<span class="pk-name">' + esc(r.name) + '</span><span class="pk-meta">' + (where ? "On page in " + esc(where.title) : r.kind === "heartbeat" ? "Every " + r.every : esc(r.target)) + "</span></button>";
      });
    });
    return h;
  }

  function moveItem(fs, fi, ts, ti) {
    var it = S.page[fs].items.splice(fi, 1)[0];
    if (fs === ts && fi < ti) ti--;
    S.page[ts].items.splice(ti, 0, it);
    return it;
  }
  function refreshAll(focusSel) { renderEditor(focusSel); renderPreviews(); }

  var drag = null;
  function wireDragList(root, selItem) {
    $$(selItem, root).forEach(function (el) {
      el.addEventListener("dragstart", function (e) {
        drag = { s: +el.getAttribute("data-s"), i: +el.getAttribute("data-i") };
        el.classList.add("dragging");
        try { e.dataTransfer.setData("text/plain", "item"); e.dataTransfer.effectAllowed = "move"; } catch (x) { /* ignore */ }
      });
      el.addEventListener("dragend", function () { el.classList.remove("dragging"); drag = null; $$(".drop-before,.drop-after").forEach(function (n) { n.classList.remove("drop-before", "drop-after"); }); });
      el.addEventListener("dragover", function (e) {
        if (!drag || drag.sec != null) return;
        e.preventDefault();
        var r = el.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
        el.classList.toggle("drop-after", after); el.classList.toggle("drop-before", !after);
      });
      el.addEventListener("dragleave", function () { el.classList.remove("drop-before", "drop-after"); });
      el.addEventListener("drop", function (e) {
        if (!drag || drag.sec != null) return;
        e.preventDefault(); e.stopPropagation();
        var ts = +el.getAttribute("data-s"), ti = +el.getAttribute("data-i") + (el.classList.contains("drop-after") ? 1 : 0);
        var it = moveItem(drag.s, drag.i, ts, ti);
        drag = null;
        announce("Moved " + it.pub + " to " + S.page[ts].title);
        refreshAll();
      });
    });
  }

  function wireEditor() {
    var ed = $("#sp-editor");
    wireDragList(ed, ".ed-item");
    $$("[data-drop-sec]", ed).forEach(function (ul) {
      ul.addEventListener("dragover", function (e) { if (drag && drag.sec == null) e.preventDefault(); });
      ul.addEventListener("drop", function (e) {
        if (!drag || drag.sec != null) return;
        e.preventDefault();
        var ts = +ul.getAttribute("data-drop-sec");
        var it = moveItem(drag.s, drag.i, ts, S.page[ts].items.length);
        drag = null; announce("Moved " + it.pub + " to " + S.page[ts].title); refreshAll();
      });
    });
    $$("[data-sec-handle]", ed).forEach(function (hd) {
      var si = +hd.getAttribute("data-sec-handle");
      hd.addEventListener("dragstart", function (e) { e.stopPropagation(); drag = { sec: si }; try { e.dataTransfer.setData("text/plain", "section"); } catch (x) { /* ignore */ } });
      hd.addEventListener("keydown", function (e) {
        var to = e.key === "ArrowUp" ? si - 1 : e.key === "ArrowDown" ? si + 1 : null;
        if (to == null || to < 0 || to >= S.page.length) return;
        e.preventDefault();
        var s = S.page.splice(si, 1)[0]; S.page.splice(to, 0, s);
        announce("Moved section " + s.title + " to position " + (to + 1));
        refreshAll('[data-sec-handle="' + to + '"]');
      });
    });
    $$(".sec-card", ed).forEach(function (card) {
      card.addEventListener("dragover", function (e) { if (drag && drag.sec != null) { e.preventDefault(); card.classList.add("drop-target"); } });
      card.addEventListener("dragleave", function () { card.classList.remove("drop-target"); });
      card.addEventListener("drop", function (e) {
        if (!drag || drag.sec == null) return;
        e.preventDefault();
        var to = +card.getAttribute("data-sec"), from = drag.sec;
        var s = S.page.splice(from, 1)[0]; S.page.splice(to, 0, s);
        drag = null; announce("Moved section " + s.title); refreshAll();
      });
    });
    $$("[data-item-handle]", ed).forEach(function (hd) {
      hd.addEventListener("keydown", function (e) {
        var p = hd.getAttribute("data-item-handle").split(":"), si = +p[0], ii = +p[1];
        var ts = si, ti;
        if (e.key === "ArrowUp") {
          if (ii > 0) ti = ii - 1; else if (si > 0) { ts = si - 1; ti = S.page[ts].items.length; } else return;
        } else if (e.key === "ArrowDown") {
          if (ii < S.page[si].items.length - 1) ti = ii + 2; else if (si < S.page.length - 1) { ts = si + 1; ti = 0; } else return;
        } else return;
        e.preventDefault();
        var it = moveItem(si, ii, ts, ti);
        var ni = S.page[ts].items.indexOf(it);
        announce("Moved " + it.pub + " to position " + (ni + 1) + " in " + S.page[ts].title);
        refreshAll('[data-item-handle="' + ts + ":" + ni + '"]');
      });
    });
    $$("[data-sec-name]", ed).forEach(function (inp) {
      inp.addEventListener("input", function () { S.page[+inp.getAttribute("data-sec-name")].title = inp.value || "Untitled section"; renderPreviews(); });
    });
    $$("[data-pub]", ed).forEach(function (inp) {
      inp.addEventListener("input", function () {
        var p = inp.getAttribute("data-pub").split(":"), it = S.page[+p[0]].items[+p[1]];
        it.pub = inp.value || it.res.name; renderPreviews();
      });
    });
    $$("[data-rm]", ed).forEach(function (b) {
      b.addEventListener("click", function () {
        var p = b.getAttribute("data-rm").split(":"), it = S.page[+p[0]].items.splice(+p[1], 1)[0];
        announce(it.pub + " taken off the page"); refreshAll();
      });
    });
    $$("[data-sec-del]", ed).forEach(function (b) {
      b.addEventListener("click", function () {
        var s = S.page.splice(+b.getAttribute("data-sec-del"), 1)[0];
        announce("Section " + s.title + " removed. Its services are back in Not on the page."); refreshAll();
      });
    });
    $$("[data-picker]", ed).forEach(function (inp) {
      var si = +inp.getAttribute("data-picker"), list = $("#pkl-" + si);
      function open() { list.innerHTML = pickerHTML(si, inp.value); list.hidden = false; inp.setAttribute("aria-expanded", "true"); wirePicker(list); }
      function close() { list.hidden = true; inp.setAttribute("aria-expanded", "false"); }
      inp.addEventListener("focus", open);
      inp.addEventListener("input", open);
      inp.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") { var f = $("button:not([disabled])", list); if (f) { e.preventDefault(); f.focus(); } }
        if (e.key === "Escape") close();
      });
      inp.parentNode.parentNode.addEventListener("focusout", function (e) { if (!inp.parentNode.parentNode.contains(e.relatedTarget)) close(); });
    });
    $$("[data-quick]", $("#sp-off")).forEach(function (b) {
      b.addEventListener("click", function () { addTo(S.page.length - 1, b.getAttribute("data-quick")); });
    });
  }
  function findRes(name) { return mon(name) || hb(name); }
  function addTo(si, name) {
    if (si < 0) { S.page.push({ title: "New section", items: [] }); si = 0; }
    var r = findRes(name);
    if (!r || onPage(r)) return;
    S.page[si].items.push({ res: r, pub: r.name });
    announce(r.name + " added to " + S.page[si].title);
    refreshAll('[data-pub="' + si + ":" + (S.page[si].items.length - 1) + '"]');
  }
  function wirePicker(list) {
    $$("button[data-add]", list).forEach(function (b, idx, all) {
      b.addEventListener("click", function () { addTo(+b.getAttribute("data-add"), b.getAttribute("data-name")); });
      b.addEventListener("keydown", function (e) {
        var en = all.filter(function (x) { return !x.disabled; }), k = en.indexOf(b);
        if (e.key === "ArrowDown" && en[k + 1]) { e.preventDefault(); en[k + 1].focus(); }
        if (e.key === "ArrowUp") { e.preventDefault(); (en[k - 1] || $("#pk-" + b.getAttribute("data-add"))).focus(); }
      });
    });
  }
  function wirePreviewEditing() {
    var pv = $("#pv");
    wireDragList(pv, ".pv-svc[draggable]");
    $$("[data-rename]", pv).forEach(function (b) {
      b.addEventListener("click", function () {
        var p = b.getAttribute("data-rename").split(":");
        var inp = $('[data-pub="' + p[0] + ":" + p[1] + '"]');
        if (inp) { inp.focus(); inp.select(); inp.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
      });
    });
  }
  function wireStatusPage() {
    renderEditor();
    $$('input[name="sp-theme"]').forEach(function (r) { r.addEventListener("change", function () { S.theme = r.value; renderPreviews(); announce("Theme " + themeName(r.value)); }); });
    $$('input[name="sp-vis"]').forEach(function (r) { r.addEventListener("change", function () { S.visibility = r.value; }); });
    $("#sp-title").addEventListener("input", function (e) { S.siteName = e.target.value || V.site.name; renderPreviews(); });
    $("#sp-addsec").addEventListener("click", function () { S.page.push({ title: "New section", items: [] }); refreshAll("#sec-name-" + (S.page.length - 1)); var f = $("#sec-name-" + (S.page.length - 1)); if (f) f.select(); });
    $("#sp-view").addEventListener("click", function (e) { e.preventDefault(); openSheet(); });
    $("#sp-publish").addEventListener("click", function () { $("#sp-msg").innerHTML = '<div class="notice notice-ok" style="margin-bottom:16px">' + icon("check") + "<p>Published. Visitors see the new page now.</p></div>"; });
  }
  function themeName(id) { return THEMES.filter(function (t) { return t.id === id; })[0].name; }

  /* ---------- Alerts ---------- */
  SCREENS.alerts = function () {
    var h = '<div class="page-head"><div><h1>Alerts</h1><p>Where we tell you when something goes down or comes back. Every monitor alerts every channel unless you pick some.</p></div><div class="row"><button type="button" class="btn btn-primary" id="al-add" aria-expanded="false" aria-controls="al-types">' + icon("plus") + "Add channel</button></div></div>";
    h += '<section class="card card-pad stack-sm" id="al-types" hidden aria-labelledby="al-types-h"><h2 id="al-types-h">Add a channel</h2><p class="hint">Pick a type. Each needs one field, then send a test.</p><div class="add-types">';
    CHANNEL_TYPES.forEach(function (c) { h += '<button type="button" data-type="' + c.type + '"><span class="chan-icon">' + icon(c.icon) + "</span>" + c.label + "</button>"; });
    h += '</div><div id="al-new"></div></section>';
    h += '<h2 class="sr-only">Channels</h2><ul class="chan-list" style="margin-top:4px">';
    CHANNELS.forEach(function (c, i) {
      var t = ctype(c.type);
      h += '<li class="card chan-card"><span class="chan-icon">' + icon(t.icon) + '</span><div class="chan-main"><div class="row" style="gap:8px"><strong>' + esc(c.name) + '</strong><span class="pill">' + t.label + '</span></div><span class="mono">' + esc(c.dest) + '</span><div class="chips"><span class="sr-only">Events: </span>' + c.events.map(function (e) { return '<span class="pill pill-accent">' + e + "</span>"; }).join("") + '</div></div><div class="row"><span class="hint" id="al-st-' + i + '">' + c.last + '</span><button type="button" class="btn btn-sm" data-test="' + i + '" aria-describedby="al-st-' + i + '">' + icon("send", "i-sm") + 'Send test</button><button type="button" class="btn btn-sm btn-ghost" aria-label="Edit ' + esc(c.name) + '">' + icon("edit", "i-sm") + "</button></div></li>";
    });
    h += "</ul>";
    return h;
  };
  function wireAlerts() {
    $("#al-add").addEventListener("click", function (e) {
      var p = $("#al-types"), open = p.hidden;
      p.hidden = !open; e.currentTarget.setAttribute("aria-expanded", String(open));
      if (open) $("button", p).focus();
    });
    $$("[data-type]").forEach(function (b) {
      b.addEventListener("click", function () {
        var t = ctype(b.getAttribute("data-type"));
        $("#al-new").innerHTML = '<div class="grid-2" style="margin-top:8px"><div class="field"><label for="al-name">Name</label><input class="input" id="al-name" placeholder="For example On-call ' + t.label + '"></div><div class="field"><label for="al-dest">' + t.field + '</label><input class="input" id="al-dest" type="' + t.input + '" placeholder="' + esc(t.ph) + '"></div></div><div class="row" style="margin-top:12px"><button type="button" class="btn btn-primary btn-sm">' + icon("send", "i-sm") + 'Save and send a test</button><span class="hint">Tells you about: Down, Back up. Change it after saving.</span></div>';
        $("#al-name").focus();
      });
    });
    $$("[data-test]").forEach(function (b) {
      b.addEventListener("click", function () { var i = b.getAttribute("data-test"); $("#al-st-" + i).textContent = "Test sent just now"; announce("Test sent to " + CHANNELS[i].name); });
    });
  }

  /* ---------- Settings ---------- */
  SCREENS.settings = function () {
    var secs = [["set-src", "Sources and keys"], ["set-users", "Users and invites"], ["set-rev", "Revisions"], ["set-io", "Import and export"], ["set-adv", "Advanced"]];
    var h = '<div class="page-head"><div><h1>Settings</h1><p>Everything that is not a monitor, a heartbeat or the page.</p></div></div><div class="set-layout"><nav class="subnav" aria-label="Settings sections">';
    secs.forEach(function (s) { h += '<button type="button" data-jump="' + s[0] + '">' + s[1] + "</button>"; });
    h += '</nav><div class="stack">';
    h += '<section class="card set-sec" id="set-src" aria-labelledby="set-src-h"><div class="card-head"><div><h2 id="set-src-h">Sources and keys</h2><p>Where checks run and the keys agents use to report in.</p></div><button type="button" class="btn btn-sm">' + icon("plus", "i-sm") + 'Add agent</button></div><table class="tbl"><thead><tr><th scope="col">Name</th><th scope="col">Kind</th><th scope="col">Last report</th><th scope="col" class="hide-sm">Key</th></tr></thead><tbody>';
    [["Cloudflare edge", "Built in", "34 s ago", "No key needed"], ["berlin-runner", "Agent", "12 s ago", "Ends in ...3f2a"], ["office-nas", "Agent", "13 min ago", "Ends in ...9c1d"], ["Uptime Kuma (legacy)", "Import", "34 s ago", "Ends in ...77be"]].forEach(function (r) {
      h += "<tr><td><strong>" + r[0] + "</strong></td><td>" + r[1] + '</td><td class="num">' + r[2] + '</td><td class="hide-sm mono">' + r[3] + "</td></tr>";
    });
    h += "</tbody></table></section>";
    h += '<section class="card set-sec" id="set-users" aria-labelledby="set-users-h"><div class="card-head"><div><h2 id="set-users-h">Users and invites</h2><p>Owners manage everything. Editors change monitors and the page.</p></div><button type="button" class="btn btn-sm">' + icon("plus", "i-sm") + 'Invite</button></div><table class="tbl"><thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col" class="hide-sm">Last active</th></tr></thead><tbody>';
    [["Maya Okafor", "maya@example.com", "Owner", "Now"], ["Jonas Lind", "jonas@example.com", "Editor", "2 d ago"], ["Priya Raman", "priya@example.org", "Invited", "Invite sent 3 d ago"]].forEach(function (u) {
      h += "<tr><td><strong>" + u[0] + '</strong><br><span class="muted small">' + u[1] + "</span></td><td>" + (u[2] === "Invited" ? '<span class="pill">Invited</span>' : u[2]) + '</td><td class="hide-sm muted">' + u[3] + "</td></tr>";
    });
    h += "</tbody></table></section>";
    h += '<section class="card set-sec" id="set-rev" aria-labelledby="set-rev-h"><div class="card-head"><div><h2 id="set-rev-h">Revisions</h2><p>Every saved change. Restore any of them.</p></div></div><table class="tbl"><thead><tr><th scope="col">Change</th><th scope="col" class="hide-sm">By</th><th scope="col">When</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead><tbody>';
    [["Renamed “Replica Postgres” to “Database replica” on the page", "Maya Okafor", "Today, 23:41"], ["Added monitor Runner ping", "Jonas Lind", "Yesterday, 17:02"], ["Switched theme to Classic", "Maya Okafor", "22 Sep"], ["Added channel #incidents", "Maya Okafor", "20 Sep"]].forEach(function (r, i) {
      h += "<tr><td>" + r[0] + '</td><td class="hide-sm muted">' + r[1] + '</td><td class="num muted">' + r[2] + "</td><td>" + (i ? '<button type="button" class="btn btn-sm">Restore</button>' : '<span class="pill">Current</span>') + "</td></tr>";
    });
    h += "</tbody></table></section>";
    h += '<section class="card card-pad set-sec stack-sm" id="set-io" aria-labelledby="set-io-h"><h2 id="set-io-h">Import and export</h2><p class="muted">Bring monitors over from Uptime Kuma, or download everything as one file.</p><div class="row"><button type="button" class="btn">Import from Uptime Kuma</button><button type="button" class="btn">Import a config file</button><button type="button" class="btn">Download config</button></div></section>';
    h += '<section class="card card-pad set-sec stack-sm" id="set-adv" aria-labelledby="set-adv-h"><h2 id="set-adv-h">Advanced</h2><p class="muted">For people who prefer text. Everything above is also here.</p>';
    h += '<details class="adv"><summary>' + icon("chev", "chev") + 'Edit config as JSON<span class="hint">Checked before saving</span></summary><div class="adv-body"><label class="sr-only" for="set-json">Config as JSON</label><textarea class="textarea" id="set-json" spellcheck="false">' + esc(configJson()) + '</textarea><div class="row"><button type="button" class="btn btn-primary btn-sm">Check and save</button><span class="hint">Saving makes a new revision you can restore.</span></div></div></details></section>';
    h += "</div></div>";
    return h;
  };
  function configJson() {
    var cfg = {
      site: { name: S.siteName, theme: THEMES.filter(function (t) { return t.id === S.theme; })[0].name.toLowerCase().replace(/\W+/g, "-"), visibility: S.visibility },
      monitors: MONITORS.slice(0, 3).map(function (m) { return { name: m.name, target: m.target, type: m.type, every: m.interval + "s" }; }),
      page: S.page.map(function (s) { return { section: s.title, show: s.items.map(function (i) { return i.pub; }) }; }),
    };
    return JSON.stringify(cfg, null, 2);
  }
  function wireSettings() {
    $$("[data-jump]").forEach(function (b) {
      b.addEventListener("click", function () {
        var t = $("#" + b.getAttribute("data-jump"));
        t.setAttribute("tabindex", "-1");
        t.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        t.focus({ preventScroll: true });
      });
    });
  }

  /* ---------- Shell: router, preview sheet, theme selects ---------- */
  var WIRE = {
    "first-run": wireFirstRun, monitors: wireMonitors, "create-monitor": wireCreateMonitor, monitor: wireMonitor,
    "monitor-pending": wireMonitorPending, "create-heartbeat": wireCreateHeartbeat, "status-page": wireStatusPage,
    alerts: wireAlerts, settings: wireSettings,
  };
  var TITLES = {
    "first-run": "Set up", monitors: "Monitors", "monitors-empty": "Monitors", "create-monitor": "New monitor", monitor: "Monitor",
    "monitor-pending": "Monitor", heartbeats: "Heartbeats", "create-heartbeat": "New heartbeat", "status-page": "Status page",
    alerts: "Alerts", settings: "Settings", incidents: "Incidents",
  };
  function currentScreen() {
    var h = (location.hash || "").replace(/^#/, "");
    return SCREENS[h] ? h : "monitors";
  }
  function announce(msg) { var l = $("#live"); l.textContent = ""; setTimeout(function () { l.textContent = msg; }, 30); }

  var lastScreen = null;
  function route(keepScroll) {
    var screen = currentScreen();
    document.body.className = "scr-" + screen + (screen === "first-run" ? " onboarding" : "");
    var crumb = CRUMB[screen] || "";
    if (screen === "monitor") crumb += S.detail;
    if (screen === "monitor-pending") crumb += (S.draft && S.draft.name) || "example.com/billing/health";
    var parts = crumb.split(" / ");
    $("#crumbs").innerHTML = parts.length > 1 ? '<a href="#' + (NAV_OF[screen] || screen) + '">' + esc(parts[0]) + "</a>" + icon("chev", "i-sm") + "<span>" + esc(parts[1]) + "</span>" : "<span>" + esc(crumb) + "</span>";
    $("#screen").innerHTML = SCREENS[screen]();
    var nav = NAV_OF[screen] || screen;
    $$("[data-nav]").forEach(function (a) { if (a.getAttribute("data-nav") === nav) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    document.title = TITLES[screen] + " · Uptellis";
    if (WIRE[screen]) WIRE[screen]();
    $$("[data-detail]").forEach(function (a) { a.addEventListener("click", function () { S.detail = a.getAttribute("data-detail"); }); });
    renderPreviews();
    if (!keepScroll && lastScreen !== null && lastScreen !== screen) {
      window.scrollTo(0, 0);
      var h1 = $("#screen h1");
      if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus({ preventScroll: true }); }
    }
    lastScreen = screen;
  }

  function openSheet() {
    var d = $("#sheet");
    renderPreview($("#pv-sheet"), true);
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  }
  $$("[data-open-preview]").forEach(function (b) { b.addEventListener("click", openSheet); });
  $("[data-close-sheet]").addEventListener("click", function () { $("#sheet").close(); });
  $("#sheet").addEventListener("click", function (e) { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $$("[data-theme-select]").forEach(function (sel) {
    sel.innerHTML = THEMES.map(function (t) { return '<option value="' + t.id + '">' + t.name + "</option>"; }).join("");
    sel.addEventListener("change", function () {
      S.theme = sel.value;
      $$('input[name="sp-theme"]').forEach(function (r) { r.checked = r.value === S.theme; });
      renderPreviews();
      if ($("#sheet").open) renderPreview($("#pv-sheet"), true);
    });
  });
  $("[data-skip]").addEventListener("click", function (e) { e.preventDefault(); var h1 = $("#screen h1"); if (h1) { h1.setAttribute("tabindex", "-1"); h1.focus(); } });
  document.addEventListener("click", function (e) {
    var c = e.target.closest && e.target.closest("[data-copy]");
    if (!c) return;
    var txt = $("#" + c.getAttribute("data-copy")).textContent;
    try { navigator.clipboard.writeText(txt); } catch (x) { /* file:// may block the clipboard */ }
    c.innerHTML = icon("check") + "Copied";
    announce("Copied to the clipboard");
    setTimeout(function () { c.innerHTML = icon("copy") + "Copy"; }, 1800);
  });
  window.addEventListener("hashchange", function () { route(false); });
  route(false);
})();
