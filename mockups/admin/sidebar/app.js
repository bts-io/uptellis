/* Uptellis admin mock-up, direction "sidebar". Vanilla JS; renders one screen per hash route. */
(function () {
  "use strict";

  var DEMO = window.UPTELLIS_DEMO;
  var V = DEMO.healthy;
  var VI = DEMO.incident;
  var NOW = Date.parse(V.now);

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function pct(r, digits) {
    if (r == null) return "No data";
    var d = digits == null ? 2 : digits;
    return (Math.floor(r * 100 * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d) + "%";
  }
  function ago(ts, now) {
    var s = Math.max(0, Math.round(((now || NOW) - Date.parse(ts)) / 1000));
    if (s < 60) return s + " s ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + " h ago";
    return Math.round(h / 24) + " days ago";
  }
  function dur(s) {
    if (s < 60) return s + " s";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60);
    return h + " h " + (m % 60) + " min";
  }
  function every(s) {
    if (!s) return "Every minute";
    if (s < 60) return "Every " + s + " seconds";
    if (s === 60) return "Every minute";
    return "Every " + Math.round(s / 60) + " minutes";
  }
  function clock(ts) {
    var d = new Date(ts);
    return String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0") + ":" + String(d.getUTCSeconds()).padStart(2, "0");
  }
  function day(ts) {
    var d = new Date(ts);
    var mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
    return mon + " " + d.getUTCDate() + ", " + String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0");
  }
  function kindLabel(k) {
    return { http: "HTTP", port: "TCP port", ping: "Ping", tls: "TLS certificate", push: "Heartbeat" }[k] || "Check";
  }

  /* ---------------- icons ---------------- */
  var P = {
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    heart: '<path d="M3 12h3l2-4 3 9 3-11 2 6h5"/>',
    alert: '<path d="M12 3 2 20h20L12 3z"/><path d="M12 10v4M12 17.5v.01"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/>',
    bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    updown: '<path d="m8 9 4-4 4 4M8 15l4 4 4-4"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    checkc: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/>',
    xc: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    warnc: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pausec: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L4 16.7 7.3 20l5.3-5.3a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.3-.5-.5-2.3 2.3-2.7z"/>',
    helpc: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.5M12 17v.01"/>',
    pause: '<path d="M9 5v14M15 5v14"/>',
    pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    send: '<path d="M21 3 10 14"/><path d="M21 3 14 21l-4-7-7-4 18-7z"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    ext: '<path d="M14 4h6v6M20 4 10 14"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    chat: '<path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/><path d="M9 11h.01M15 11h.01"/>',
    hash: '<path d="M5 9h15M4 15h15M10 4 8 20M16 4l-2 16"/>',
    plane: '<path d="M21 4 3 11l6 2 2 6 3-4 5 4 2-15z"/><path d="m9 13 8-6"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
    ring: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2z"/><path d="M3 6c.8-1.5 1.8-2.5 3-3M21 6c-.8-1.5-1.8-2.5-3-3"/>',
    server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
    code: '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6l-8-3z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18 6"/>',
    logo: '<path d="M4 13h3l2-5 3 9 2.5-6H20"/>'
  };
  function ic(name, cls) {
    return '<svg class="i' + (cls ? " " + cls : "") + '" viewBox="0 0 24 24" aria-hidden="true">' + (P[name] || "") + "</svg>";
  }

  var STATE = {
    up: { word: "Up", icon: "checkc" },
    down: { word: "Down", icon: "xc" },
    degraded: { word: "Degraded", icon: "warnc" },
    late: { word: "Late", icon: "warnc" },
    pending: { word: "Pending", icon: "clock" },
    paused: { word: "Paused", icon: "pausec" },
    maintenance: { word: "Maintenance", icon: "wrench" },
    stale: { word: "No recent data", icon: "helpc" },
    unknown: { word: "Unknown", icon: "helpc" }
  };
  function st(state) {
    var s = STATE[state] || STATE.unknown;
    return '<span class="st st-' + esc(state) + '">' + ic(s.icon) + esc(s.word) + "</span>";
  }

  function strip(beats) {
    var up = 0, bad = 0, none = 0;
    var rects = beats.map(function (b, i) {
      var c = b.worst == null ? "none" : b.worst === "up" ? "up" : b.worst === "down" ? "down" : b.worst === "maintenance" ? "maintenance" : "degraded";
      if (c === "up") up++; else if (c === "none") none++; else bad++;
      return '<rect class="' + c + '" x="' + i * 3 + '" y="0" width="2" height="22" rx="1"/>';
    }).join("");
    var label = "Last 90 days: " + up + " days fully up, " + bad + " with problems" + (none ? ", " + none + " without data" : "");
    return '<svg class="strip" viewBox="0 0 269 22" preserveAspectRatio="none" role="img" aria-label="' + label + '"><title>' + label + "</title>" + rects + "</svg>";
  }
  function uptime7(s) {
    var last = s.beats90d.slice(-7).filter(function (b) { return b.uptime != null; });
    if (!last.length) return null;
    return last.reduce(function (a, b) { return a + b.uptime; }, 0) / last.length;
  }

  /* ---------------- invented data (not in the view) ---------------- */
  var ALL = [];
  V.sections.forEach(function (sec) { sec.services.forEach(function (s) { ALL.push({ s: s, group: sec.title }); }); });
  V.unsectioned.forEach(function (s) { ALL.push({ s: s, group: "Other" }); });

  var HEARTBEATS = [
    { name: "Nightly database backup", every: "Every day", grace: "30 min grace", lastS: 6 * 3600 + 120, state: "up", note: "OK, 2.1 GB written" },
    { name: "Invoice sync job", every: "Every 15 minutes", grace: "5 min grace", lastS: 260, state: "up", note: "OK" },
    { name: "Search index rebuild", every: "Every hour", grace: "10 min grace", lastS: 4440, state: "late", note: "No ping for 1 h 14 min" },
    { name: "Log shipper", every: "Every 5 minutes", grace: "1 min grace", lastS: null, state: "pending", note: "Waiting for the first ping" }
  ];
  var CHANNELS = [
    { type: "discord", name: "Ops alerts", dest: "Acme Discord, #ops-alerts", events: ["Down", "Back up", "Data went quiet"], last: "Delivered 2 days ago" },
    { type: "email", name: "On-call inbox", dest: "oncall@example.com", events: ["Down", "Back up"], last: "Delivered 2 days ago" },
    { type: "slack", name: "Engineering", dest: "#incidents in Acme Slack", events: ["Down", "Back up"], last: "Test sent 5 days ago" }
  ];
  var TYPES = [
    { id: "email", name: "Email", icon: "mail", field: "Email address", ph: "you@example.com", input: "email" },
    { id: "discord", name: "Discord", icon: "chat", field: "Discord webhook URL", ph: "https://discord.com/api/webhooks/...", input: "url" },
    { id: "slack", name: "Slack", icon: "hash", field: "Slack webhook URL", ph: "https://hooks.slack.com/services/...", input: "url" },
    { id: "telegram", name: "Telegram", icon: "plane", field: "Telegram chat", ph: "@your_channel or a chat number", input: "text" },
    { id: "sms", name: "SMS", icon: "phone", field: "Mobile number", ph: "+1 555 0100", input: "tel" },
    { id: "ntfy", name: "ntfy", icon: "ring", field: "ntfy topic URL", ph: "https://ntfy.sh/acme-alerts", input: "url" },
    { id: "webhook", name: "Webhook", icon: "link", field: "Webhook URL", ph: "https://example.com/hooks/uptime", input: "url" }
  ];
  function typeOf(id) { return TYPES.filter(function (t) { return t.id === id; })[0]; }
  var THEMES = [
    { name: "sys.status", c: ["#0e1116", "#3ecf8e", "#2b3342"] },
    { name: "Control Room", c: ["#05070b", "#57e3ff", "#1d2a38"] },
    { name: "Session", c: ["#15121c", "#c8a2ff", "#2c2638"] },
    { name: "Classic", c: ["#ffffff", "#22a06b", "#e4e7ec"] },
    { name: "Editorial", c: ["#faf7f2", "#1f1d1a", "#d9d2c5"] },
    { name: "Dashboard", c: ["#f3f5fb", "#5b63f0", "#dfe3f0"] },
    { name: "Wallboard", c: ["#000000", "#39ff88", "#1b1b1b"] },
    { name: "Friendly", c: ["#fff7ef", "#ff8a65", "#ffe0cc"] },
    { name: "Minimal", c: ["#ffffff", "#111111", "#ececec"] }
  ];

  /* ---------------- shell ---------------- */
  var NAV = [
    { id: "monitors", label: "Monitors", icon: "activity", match: ["monitors", "monitors-empty", "create-monitor", "monitor", "monitor-pending"], count: String(ALL.length) },
    { id: "heartbeats", label: "Heartbeats", icon: "heart", match: ["heartbeats", "create-heartbeat"], count: String(HEARTBEATS.length) },
    { id: "incidents", label: "Incidents", icon: "alert", match: ["incidents"], count: "" },
    { id: "status-page", label: "Status page", icon: "globe", match: ["status-page"], count: "" },
    { id: "alerts", label: "Alerts", icon: "bell", match: ["alerts"], count: String(CHANNELS.length) },
    { id: "settings", label: "Settings", icon: "gear", match: ["settings"], count: "" }
  ];

  function shell(route, content) {
    var nav = NAV.map(function (n) {
      var cur = n.match.indexOf(route) >= 0 ? ' aria-current="page"' : "";
      var count = route === "monitors-empty" && n.id === "monitors" ? "0" : n.count;
      return '<a href="#' + n.id + '"' + cur + ">" + ic(n.icon) + "<span>" + n.label + "</span>" + (count ? '<span class="count">' + count + "</span>" : "") + "</a>";
    }).join("");
    return (
      '<header class="topbar">' +
        '<button class="btn icon ghost" type="button" id="menuBtn" aria-label="Open menu" aria-expanded="false" aria-controls="sidebar">' + ic("menu") + "</button>" +
        '<div class="brand"><span class="mark">' + ic("logo") + "</span><span>" + esc(V.site.name) + "</span></div>" +
        '<a class="btn sm primary" href="#create-monitor">' + ic("plus") + "New</a>" +
      "</header>" +
      '<div class="scrim" id="scrim"></div>' +
      '<div class="app">' +
        '<aside class="sidebar" id="sidebar" aria-label="Main">' +
          '<div class="brand"><span class="mark">' + ic("logo") + "</span>Uptellis</div>" +
          '<details class="switcher"><summary aria-label="Switch site, current: ' + esc(V.site.name) + '">' +
            '<span class="site-ico" aria-hidden="true">' + esc(V.site.name.slice(0, 1)) + "</span>" +
            '<span class="site-meta"><b>' + esc(V.site.name) + "</b><span>" + esc(V.site.hostnames[0]) + "</span></span>" + ic("updown") +
          "</summary>" +
            '<div class="menu">' +
              '<a href="#monitors">' + ic("check") + esc(V.site.name) + "</a>" +
              '<a href="#monitors-empty"><span style="width:16px"></span>Acme Staging</a>' +
              '<a href="#monitors-empty"><span style="width:16px"></span>Internal tools</a><hr>' +
              '<a href="#first-run">' + ic("plus") + "Add a site</a>" +
            "</div></details>" +
          '<nav class="nav" aria-label="Sections">' + nav + "</nav>" +
          '<div class="side-foot">' +
            '<div class="help-card"><b>Status page is live</b>' + esc(V.site.hostnames[0]) + ' <a href="#status-page">Edit</a></div>' +
            '<div class="user"><span class="avatar" aria-hidden="true">DR</span><span class="who"><b>Dana Reyes</b><span>Owner</span></span></div>' +
          "</div>" +
        "</aside>" +
        '<main id="main" tabindex="-1">' + content + "</main>" +
      "</div>"
    );
  }

  function titleRow(title, sub, actions, crumbs) {
    return (
      (crumbs ? '<nav class="crumbs" aria-label="Breadcrumb">' + crumbs + "</nav>" : "") +
      '<div class="title-row"><div class="t"><h1>' + title + "</h1>" + (sub ? '<p class="sub">' + sub + "</p>" : "") + "</div>" +
      (actions ? '<div class="actions">' + actions + "</div>" : "") + "</div>"
    );
  }

  /* ---------------- checklist ---------------- */
  function checklist(doneCount) {
    var items = [
      { t: "Add your first monitor", d: "We check it every minute.", done: true, a: '<a class="btn sm" href="#create-monitor">Add monitor</a>' },
      { t: "Choose where alerts go", d: "Discord is set up and tested.", done: doneCount >= 2, a: '<a class="btn sm" href="#alerts">Add channel</a>' },
      { t: "Invite colleagues", d: "Share the on-call load.", done: doneCount >= 3, a: '<a class="btn sm" href="#settings">Invite</a>' },
      { t: "Publish your status page", d: "Tell customers what is up.", done: doneCount >= 4, a: '<a class="btn sm" href="#status-page">Set up page</a>' }
    ];
    var n = items.filter(function (i) { return i.done; }).length;
    return (
      '<section class="card checklist" aria-labelledby="cl-h">' +
        '<div class="card-h"><h2 id="cl-h">Finish setting up <span class="pill accent">' + n + " of 4 done</span></h2>" +
        '<div style="display:flex;align-items:center;gap:12px"><div class="progress" role="progressbar" aria-label="Setup progress" aria-valuemin="0" aria-valuemax="4" aria-valuenow="' + n + '"><i style="width:' + n * 25 + '%"></i></div>' +
        '<button class="btn sm ghost" type="button" data-toast="Checklist hidden. Find it again under Settings.">Hide</button></div></div>' +
        '<ol class="steps">' + items.map(function (i, k) {
          return '<li class="' + (i.done ? "done" : "") + '"><div class="step-h"><span class="tick">' + (i.done ? ic("check") + '<span class="sr-only">Done:</span>' : k + 1) + "</span>" + i.t + "</div><p>" + i.d + "</p>" + (i.done ? "" : i.a) + "</li>";
        }).join("") + "</ol>" +
      "</section>"
    );
  }

  /* ---------------- screens ---------------- */
  function monitorRow(e) {
    var s = e.s;
    var last = s.recent[0];
    return (
      '<li><a class="mrow" href="#monitor">' +
        '<span class="c-state">' + st(s.state) + "</span>" +
        '<span class="name"><b>' + esc(s.name) + "</b><span>" + esc(kindLabel(s.kind)) + " · " + esc(s.targetDisplay || "") + "</span></span>" +
        '<span class="c-strip">' + strip(s.beats90d) + "</span>" +
        '<span class="right c-up">' + pct(s.uptime30d) + "<small>30 days</small></span>" +
        '<span class="right c-last">' + (last ? ago(last.ts) : "Never") + "<small>" + esc(every(s.intervalS).toLowerCase()) + "</small></span>" +
        '<span class="right c-resp">' + (s.latencyMs != null ? s.latencyMs + " ms" : "None") + "<small>response</small></span>" +
        '<span class="c-meta"><span>' + pct(s.uptime30d) + " in 30 days</span><span>" + (last ? "Checked " + ago(last.ts) : "") + "</span></span>" +
      "</a></li>"
    );
  }

  function screenMonitors() {
    var up = ALL.filter(function (e) { return e.s.state === "up"; }).length;
    var rows = ALL.map(monitorRow).join("");
    return (
      '<div class="page">' +
        titleRow("Monitors", "Websites, APIs and servers we check for you.", '<a class="btn primary" href="#create-monitor">' + ic("plus") + "New monitor</a>") +
        checklist(2) +
        '<div class="toolbar">' +
          '<div class="input-wrap">' + ic("search") + '<label class="sr-only" for="q">Search monitors</label><input id="q" class="input" type="search" placeholder="Search by name or address"></div>' +
          '<label class="sr-only" for="fstate">Show</label><select id="fstate" class="input" style="width:auto"><option>All states</option><option>Up</option><option>Down</option><option>Paused</option></select>' +
          '<div class="summary"><span>' + st("up") + " " + up + "</span><span>" + st("down") + " " + (ALL.length - up) + '</span><span class="num">' + ALL.length + " monitors</span></div>" +
        "</div>" +
        '<div class="rows-head" aria-hidden="true"><span>State</span><span>Monitor</span><span>Last 90 days</span><span style="text-align:right">Uptime</span><span style="text-align:right">Last check</span><span class="c-resp" style="text-align:right">Response</span></div>' +
        '<ul class="rows" id="mlist" aria-label="Monitors">' + rows + "</ul>" +
        '<p class="muted small" id="nores" hidden style="padding:16px 4px">No monitors match that search.</p>' +
      "</div>"
    );
  }

  function screenMonitorsEmpty() {
    return (
      '<div class="page">' +
        titleRow("Monitors", "Websites, APIs and servers we check for you.") +
        '<section class="card empty" aria-labelledby="em-h">' +
          '<div class="art">' + ic("radar") + "</div>" +
          '<h2 id="em-h" class="sr-only">No monitors yet</h2>' +
          "<p>Nothing is being watched yet. Add a URL and we check it every minute.</p>" +
          '<a class="btn primary" href="#create-monitor">' + ic("plus") + "Add your first monitor</a>" +
        "</section>" +
      "</div>"
    );
  }

  function screenCreateMonitor() {
    return (
      '<div class="page narrow">' +
        titleRow("New monitor", "", "", '<a href="#monitors">Monitors</a>' + ic("chevron") + '<span aria-current="page">New monitor</span>') +
        '<form id="cmForm" novalidate>' +
          '<section class="group" aria-labelledby="g1">' +
            '<div class="explain"><h2 id="g1">What to watch</h2><p>Paste a website, API address, host name or IP. We work out the kind of check from what you type.</p></div>' +
            '<div class="fields">' +
              '<div class="field"><label for="url">URL or host</label><input id="url" class="input lg" type="text" inputmode="url" autocomplete="off" value="https://shop.example.com/health" aria-describedby="url-h"><span class="hint" id="url-h">For example https://example.com, example.com:5432 or 192.0.2.10</span></div>' +
              '<fieldset class="field"><legend>Check type <span class="pill accent" id="inferred">Detected from the URL</span></legend>' +
                '<div class="seg" role="radiogroup" aria-label="Check type">' +
                  ["http:HTTP(S)", "tcp:TCP port", "ping:Ping", "tls:TLS certificate"].map(function (x, i) {
                    var p = x.split(":");
                    return '<label><input type="radio" name="ctype" value="' + p[0] + '"' + (i === 0 ? " checked" : "") + "><span>" + p[1] + "</span></label>";
                  }).join("") +
                "</div></fieldset>" +
              '<div class="field"><label for="mname">Name</label><input id="mname" class="input" type="text" value="shop.example.com" aria-describedby="mname-h"><span class="hint" id="mname-h">Filled in from the host. This is what alerts and the status page show.</span></div>' +
            "</div>" +
          "</section>" +
          '<section class="group" aria-labelledby="g2">' +
            '<div class="explain"><h2 id="g2">How often</h2><p>Faster checks catch problems sooner. Every minute suits most sites.</p></div>' +
            '<div class="fields"><div class="field"><label for="interval">Check</label><select id="interval" class="input">' +
              ["Every 30 seconds", "Every minute", "Every 2 minutes", "Every 5 minutes", "Every 15 minutes"].map(function (o) { return "<option" + (o === "Every minute" ? " selected" : "") + ">" + o + "</option>"; }).join("") +
            "</select></div></div>" +
          "</section>" +
          '<section class="group" aria-labelledby="g3">' +
            '<div class="explain"><h2 id="g3">Who hears about it</h2><p>We alert when it goes down and again when it is back.</p></div>' +
            '<div class="fields"><fieldset><legend class="sr-only">Alert</legend><div class="checks">' +
              '<label class="check"><input type="radio" name="alertto" checked><span>All alert channels<small>' + CHANNELS.map(function (c) { return esc(c.name); }).join(", ") + "</small></span></label>" +
              '<label class="check"><input type="radio" name="alertto"><span>Only some channels<small>Pick them after you create the monitor.</small></span></label>' +
              '<label class="check"><input type="radio" name="alertto"><span>Nobody<small>Show it on dashboards only.</small></span></label>' +
            "</div></fieldset></div>" +
          "</section>" +
          '<details class="adv"><summary><h2>' + ic("chevron", "chev") + 'Advanced settings</h2><span class="sumline">GET, expects 200 to 399, 10 s timeout, 1 retry, runs on Cloudflare edge</span></summary>' +
            '<section class="group" aria-label="Request">' +
              '<div class="explain"><p>Change these only if the defaults do not fit. Most monitors never need them.</p></div>' +
              '<div class="fields">' +
                '<div class="row2"><div class="field"><label for="method">Method</label><select id="method" class="input"><option>GET</option><option>HEAD</option><option>POST</option></select></div>' +
                '<div class="field"><label for="exp">Expected status</label><input id="exp" class="input" value="200-399"></div></div>' +
                '<div class="field"><label for="kw">Keyword on the page</label><input id="kw" class="input" placeholder="Optional, for example Welcome" aria-describedby="kw-h"><span class="hint" id="kw-h">Down if this text is missing from the response.</span></div>' +
                '<div class="row2"><div class="field"><label for="to">Timeout</label><select id="to" class="input"><option>5 seconds</option><option selected>10 seconds</option><option>30 seconds</option></select></div>' +
                '<div class="field"><label for="rt">Retries before alerting</label><select id="rt" class="input"><option>None</option><option selected>1 retry</option><option>2 retries</option><option>3 retries</option></select></div></div>' +
                '<div class="row2"><div class="field"><label for="where">Where it runs</label><select id="where" class="input"><option selected>Cloudflare edge</option><option>Agent: Frankfurt rack</option><option>Agent: Office Berlin</option><option>Agent: Home lab</option></select></div>' +
                '<div class="field"><label for="quorum">Down when</label><select id="quorum" class="input"><option selected>Any location fails</option><option>2 of 3 locations fail</option><option>All locations fail</option></select></div></div>' +
              "</div>" +
            "</section>" +
          "</details>" +
          '<div class="savebar"><span class="note">First check runs right after you create it.</span><a class="btn ghost" href="#monitors">Cancel</a><button class="btn primary" type="submit">Create monitor</button></div>' +
        "</form>" +
      "</div>"
    );
  }

  function inferType(v) {
    v = v.trim();
    if (/^https?:\/\//i.test(v)) return "http";
    if (/^tls:\/\//i.test(v) || /:443$/.test(v)) return "tls";
    if (/:\d+$/.test(v)) return "tcp";
    if (/^[\d.]+$/.test(v) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v)) return v.indexOf(".") > 0 && !/^[\d.]+$/.test(v) ? "http" : "ping";
    return "http";
  }
  function hostOf(v) {
    return v.trim().replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0].replace(/:\d+$/, "") || "";
  }

  function chart(points, h) {
    var W = 720, H = h || 190, pl = 40, pr = 8, pt = 10, pb = 22;
    var vals = points.filter(function (p) { return p != null; });
    var max = Math.max.apply(null, vals) * 1.15, min = 0;
    var step = (W - pl - pr) / (points.length - 1);
    function y(v) { return pt + (H - pt - pb) * (1 - (v - min) / (max - min)); }
    var segs = [], cur = [];
    points.forEach(function (p, i) {
      if (p == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([pl + i * step, y(p)]);
    });
    if (cur.length) segs.push(cur);
    var line = segs.map(function (s) { return "M" + s.map(function (q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join(" L"); }).join(" ");
    var area = segs.map(function (s) { return "M" + s[0][0].toFixed(1) + " " + (H - pb) + " L" + s.map(function (q) { return q[0].toFixed(1) + " " + q[1].toFixed(1); }).join(" L") + " L" + s[s.length - 1][0].toFixed(1) + " " + (H - pb) + "Z"; }).join(" ");
    var fails = points.map(function (p, i) { return p == null ? '<rect class="fail" x="' + (pl + i * step - 2).toFixed(1) + '" y="' + (H - pb - 6) + '" width="4" height="6" rx="1"/>' : ""; }).join("");
    var ticks = [0, 0.5, 1].map(function (f) {
      var v = Math.round(max * f);
      return '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>';
    }).join("");
    var labels = [0, 0.5, 1].map(function (f) {
      var v = Math.round(max * f);
      return '<text x="' + (pl - 6) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + v + "</text>";
    }).join("");
    return (
      '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<defs><linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".28"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>' +
        '<g class="grid">' + ticks + "</g>" +
        '<path class="area" d="' + area + '"/><path class="line" d="' + line + '" vector-effect="non-scaling-stroke"/>' + fails +
        '<g class="axis">' + labels + '<text x="' + pl + '" y="' + (H - 5) + '">2 h ago</text><text x="' + (W - pr) + '" y="' + (H - 5) + '" text-anchor="end">now</text></g>' +
      "</svg>"
    );
  }

  // A longer series for the chart: the real recent checks at the end, earlier points generated around the average.
  function series(s) {
    var n = 60, out = [], seed = 7;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    var base = s.avgLatencyMs || s.latencyMs || 200;
    var real = s.recent.slice().reverse().map(function (b) { return b.status === "down" ? null : b.latencyMs; });
    for (var i = 0; i < n - real.length; i++) out.push(Math.round(base * (0.9 + rnd() * 0.22) + (i % 17 === 5 ? base * 0.35 : 0)));
    return out.concat(real);
  }

  function screenMonitor() {
    var s = null;
    VI.sections.forEach(function (sec) { sec.services.forEach(function (x) { if (x.state === "down" && !s) s = x; }); });
    if (!s) s = VI.sections[0].services[0];
    var open = VI.incidents.open.filter(function (i) { return i.serviceId === s.id; })[0];
    var past = VI.incidents.recent.filter(function (i) { return i.serviceId === s.id; }).slice(0, 4);
    var pts = series(s);
    var vals = pts.filter(function (p) { return p != null; });
    var avg = Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length);
    var nowI = Date.parse(VI.now);
    var checks = s.recent.map(function (b) {
      return "<tr><td>" + st(b.status) + '</td><td class="num">' + clock(b.ts) + ' <span class="muted small hide-sm">UTC</span></td><td class="r">' + (b.latencyMs != null ? b.latencyMs + " ms" : "None") + '</td><td class="hide-sm">' + esc(b.message || "") + '</td><td class="hide-sm">Cloudflare edge</td></tr>';
    }).join("");
    var incs = (open ? [open] : []).concat(past).map(function (i) {
      return "<li>" + (i.endedAt ? st("up") : st("down")) + '<div class="inc-b"><b>' + esc(i.endedAt ? "Was down" : "Down now") + "</b><span>" + day(i.startedAt) + " UTC, " + (i.endedAt ? "lasted " + dur(i.durationS) : "for " + dur(i.durationS) + " so far") + "</span></div></li>";
    }).join("");
    return (
      '<div class="page">' +
        '<nav class="crumbs" aria-label="Breadcrumb"><a href="#monitors">Monitors</a>' + ic("chevron") + '<span aria-current="page">' + esc(s.name) + "</span></nav>" +
        '<div class="title-row"><div class="mon-head"><span class="big-state down">' + ic("xc") + '</span><div class="t"><h1>' + esc(s.name) + "</h1>" +
          '<div class="meta-line"><span>' + st(s.state) + "</span><span>" + esc(kindLabel(s.kind)) + " · " + esc(s.targetDisplay) + "</span><span>" + ic("clock") + esc(every(s.intervalS)) + "</span><span>" + ic("globe") + "Cloudflare edge</span></div></div></div>" +
          '<div class="actions">' +
            '<button class="btn" type="button" data-toast="Test alert sent to ' + CHANNELS.length + ' channels">' + ic("send") + "Send test alert</button>" +
            '<button class="btn" type="button" data-toast="' + esc(s.name) + ' paused. No checks, no alerts.">' + ic("pause") + "Pause</button>" +
            '<a class="btn" href="#create-monitor">' + ic("pencil") + "Edit</a>" +
            '<details class="more"><summary class="btn icon" aria-label="More actions">' + ic("dots") + '</summary><div class="menu">' +
              '<button type="button" data-toast="Link copied">' + ic("copy") + "Copy link</button>" +
              '<a href="#monitors">' + ic("copy") + "Duplicate</a><hr>" +
              '<button type="button" class="danger" data-toast="' + esc(s.name) + ' deleted. Undo within 10 seconds.">' + ic("trash") + "Delete monitor</button>" +
            "</div></details>" +
          "</div></div>" +
        (open ? '<div class="banner down" role="alert">' + ic("xc") + '<div class="b-body"><b>Down for ' + dur(open.durationS) + "</b><span>Connection refused since " + clock(open.startedAt) + " UTC. We alerted " + CHANNELS.map(function (c) { return esc(c.name); }).join(", ") + ".</span></div>" + '<button class="btn sm" type="button" data-toast="Marked as acknowledged. Reminders paused.">Acknowledge</button></div>' : "") +
        '<dl class="stats">' +
          '<div class="stat"><dt>Currently</dt><dd>' + st(s.state) + ' <small>for ' + (open ? dur(open.durationS) : "a while") + "</small></dd></div>" +
          '<div class="stat"><dt>Last checked</dt><dd>' + ago(s.recent[0].ts, nowI) + "</dd></div>" +
          '<div class="stat"><dt>Uptime 24 h / 7 d / 30 d</dt><dd style="font-size:16px">' + pct(s.uptime24h) + ' <small>/ ' + pct(uptime7(s)) + " / " + pct(s.uptime30d) + "</small></dd></div>" +
          '<div class="stat"><dt>Average response</dt><dd>' + (s.avgLatencyMs || avg) + "<small>ms</small></dd></div>" +
        "</dl>" +
        '<div class="split"><div class="stack">' +
          '<section class="card" aria-labelledby="rt-h"><div class="card-h"><h2 id="rt-h">Response time</h2><div class="seg" role="radiogroup" aria-label="Range"><label><input type="radio" name="rng" checked><span>2 h</span></label><label><input type="radio" name="rng"><span>24 h</span></label><label><input type="radio" name="rng"><span>7 d</span></label></div></div>' +
            '<div class="card-b">' + chart(pts) + '<div class="chart-legend"><span>Average <b>' + avg + ' ms</b></span><span>Fastest <b>' + Math.min.apply(null, vals) + ' ms</b></span><span>Slowest <b>' + Math.max.apply(null, vals) + ' ms</b></span><span>' + ic("xc") + " Red marks are failed checks</span></div></div></section>" +
          '<section class="card" aria-labelledby="rc-h"><div class="card-h"><h2 id="rc-h">Recent checks</h2><a class="small" href="#monitor">See all</a></div>' +
            '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Result</th><th>Time</th><th class="r">Response</th><th class="hide-sm">Details</th><th class="hide-sm">From</th></tr></thead><tbody>' + checks + "</tbody></table></div></section>" +
        "</div><div class=\"stack\">" +
          '<section class="card" aria-labelledby="in-h"><div class="card-h"><h2 id="in-h">Incidents</h2><span class="muted small">Last 30 days</span></div><ul class="inc-list">' + incs + "</ul></section>" +
          '<section class="card" aria-labelledby="h90"><div class="card-h"><h2 id="h90">Last 90 days</h2></div><div class="card-b">' + strip(s.beats90d) + '<p class="muted small" style="margin-top:8px">' + pct(s.uptime30d) + " uptime in the last 30 days</p></div></section>" +
          '<section class="card" aria-labelledby="st-h"><div class="card-h"><h2 id="st-h">Settings</h2><a class="small" href="#create-monitor">Edit</a></div><div class="card-b"><dl class="kv">' +
            "<dt>Checks</dt><dd>" + esc(every(s.intervalS)) + "</dd><dt>Timeout</dt><dd>10 seconds</dd><dt>Retries</dt><dd>1 before alerting</dd><dt>Alerts go to</dt><dd>All channels (" + CHANNELS.length + ")</dd><dt>On status page</dt><dd>Database</dd>" +
          "</dl></div></section>" +
        "</div></div>" +
      "</div>"
    );
  }

  function screenMonitorPending() {
    return (
      '<div class="page">' +
        '<nav class="crumbs" aria-label="Breadcrumb"><a href="#monitors">Monitors</a>' + ic("chevron") + '<span aria-current="page">shop.example.com</span></nav>' +
        '<div class="title-row"><div class="mon-head"><span class="big-state pending" id="pbig">' + ic("clock") + '</span><div class="t"><h1>shop.example.com</h1>' +
          '<div class="meta-line"><span id="pstate">' + st("pending") + "</span><span>HTTP · https://shop.example.com/health</span><span>" + ic("clock") + "Every minute</span><span>" + ic("globe") + "Cloudflare edge</span></div></div></div>" +
          '<div class="actions"><button class="btn" type="button" data-toast="Test alert sent to ' + CHANNELS.length + ' channels">' + ic("send") + 'Send test alert</button><a class="btn" href="#create-monitor">' + ic("pencil") + "Edit</a></div></div>" +
        '<div class="banner pending" id="pbanner" aria-live="polite"><span class="live" aria-hidden="true"></span><div class="b-body"><b>Pending, waiting for the first check</b><span>It runs within a minute. This page updates by itself, no need to refresh.</span></div></div>' +
        '<dl class="stats">' +
          '<div class="stat skel"><dt>Currently</dt><dd>Waiting</dd></div>' +
          '<div class="stat skel"><dt>Last checked</dt><dd>Not yet</dd></div>' +
          '<div class="stat skel"><dt>Uptime 24 h / 7 d / 30 d</dt><dd>Starts after the first check</dd></div>' +
          '<div class="stat skel"><dt>Average response</dt><dd>No data yet</dd></div>' +
        "</dl>" +
        '<div class="split"><div class="stack">' +
          '<section class="card" aria-labelledby="pc-h"><div class="card-h"><h2 id="pc-h">Recent checks</h2></div><div class="card-b" id="pchecks"><p class="muted">Checks appear here as they run.</p></div></section>' +
        '</div><div class="stack">' +
          '<section class="card" aria-labelledby="nx-h"><div class="card-h"><h2 id="nx-h">While you wait</h2></div><ul class="inc-list">' +
            "<li>" + ic("bell") + '<div class="inc-b"><b>Alerts go to all channels</b><span>' + CHANNELS.map(function (c) { return esc(c.name); }).join(", ") + '</span></div><button class="btn sm" type="button" data-toast="Test alert sent">Test</button></li>' +
            "<li>" + ic("globe") + '<div class="inc-b"><b>Add it to your status page</b><span>Customers see a friendly name, not the URL.</span></div><a class="btn sm" href="#status-page">Add</a></li>' +
            "<li>" + ic("plus") + '<div class="inc-b"><b>Watch something else</b><span>APIs, databases, cron jobs.</span></div><a class="btn sm" href="#create-monitor">New</a></li>' +
          "</ul></section>" +
        "</div></div>" +
      "</div>"
    );
  }

  function screenHeartbeats() {
    var rows = HEARTBEATS.map(function (h) {
      return (
        '<li><div class="hrow">' +
          '<span class="c-state">' + st(h.state) + "</span>" +
          '<span class="name" style="display:flex;flex-direction:column;min-width:0"><b style="font-weight:600">' + esc(h.name) + '</b><span class="muted small">' + esc(h.note) + "</span></span>" +
          '<span class="c-sched">' + esc(h.every) + ", " + esc(h.grace) + "</span>" +
          '<span class="c-last num">' + (h.lastS == null ? '<span class="muted">No ping yet</span>' : "Last ping " + dur(h.lastS) + " ago") + "</span>" +
          '<span class="c-more"><a class="btn sm icon ghost" href="#create-heartbeat" aria-label="Edit ' + esc(h.name) + '">' + ic("pencil") + "</a></span>" +
        "</div></li>"
      );
    }).join("");
    return (
      '<div class="page">' +
        titleRow("Heartbeats", "For cron jobs and scripts: they ping us, and we alert you when a ping is late.", '<a class="btn primary" href="#create-heartbeat">' + ic("plus") + "New heartbeat</a>") +
        '<div class="rows-head hb" aria-hidden="true"><span>State</span><span>Heartbeat</span><span>Expected</span><span>Last ping</span><span></span></div>' +
        '<ul class="rows" aria-label="Heartbeats">' + rows + "</ul>" +
      "</div>"
    );
  }

  var HB_URL = "https://status.example.com/api/push/7Kq2xR9mT4vLp8Wz";
  function screenCreateHeartbeat() {
    var unit = function (id, sel) {
      return '<select id="' + id + '" class="input" aria-label="' + (id === "hbu1" ? "Interval unit" : "Grace unit") + '">' + ["minutes", "hours", "days"].map(function (u) { return "<option" + (u === sel ? " selected" : "") + ">" + u + "</option>"; }).join("") + "</select>";
    };
    return (
      '<div class="page narrow">' +
        titleRow("New heartbeat", "", "", '<a href="#heartbeats">Heartbeats</a>' + ic("chevron") + '<span aria-current="page">New heartbeat</span>') +
        '<section class="group" aria-labelledby="h1g">' +
          '<div class="explain"><h2 id="h1g">What to expect</h2><p>Your job calls a URL when it runs. If no call arrives in time, we alert you.</p></div>' +
          '<div class="fields">' +
            '<div class="field"><label for="hbname">Name</label><input id="hbname" class="input" value="Nightly database backup"></div>' +
            '<div class="field"><span class="label" id="sch-l">Schedule</span><div class="sentence" role="group" aria-labelledby="sch-l">Expect a heartbeat every <label class="sr-only" for="hbn1">Interval</label><input id="hbn1" class="input" type="number" min="1" value="60">' + unit("hbu1", "minutes") + ' with a grace period of <label class="sr-only" for="hbn2">Grace period</label><input id="hbn2" class="input" type="number" min="0" value="1">' + unit("hbu2", "minutes") + ".</div></div>" +
          "</div>" +
        "</section>" +
        '<section class="group" aria-labelledby="h2g">' +
          '<div class="explain"><h2 id="h2g">Your ping URL</h2><p>Call it from the end of your job. Add <span class="mono">status=down</span> to report a failure yourself.</p></div>' +
          '<div class="fields">' +
            '<div class="banner pending" style="margin-bottom:16px"><span class="live" aria-hidden="true"></span><div class="b-body"><b>Created. Pending, waiting for the first ping</b><span>' + st("pending") + " until your job calls the URL below.</span></div></div>" +
            '<div class="field"><span class="label" id="u-l">URL</span><div class="codebox" aria-labelledby="u-l"><code id="hburl">' + esc(HB_URL) + '</code><button class="btn" type="button" data-copy="hburl">' + ic("copy") + "Copy</button></div></div>" +
            '<div class="field"><span class="label" id="c-l">Or paste this into your script</span><div class="codebox" aria-labelledby="c-l"><code id="hbcurl">curl -fsS "' + esc(HB_URL) + '?status=up&amp;msg=OK"</code><button class="btn" type="button" data-copy="hbcurl">' + ic("copy") + "Copy</button></div></div>" +
            '<div class="field"><div class="note">' + ic("lock") + "<span>This URL is shown once. Anyone with it can report for this job, so keep it with your secrets. Lost it? Make a new one from the heartbeat page.</span></div></div>" +
          "</div>" +
        "</section>" +
        '<div class="savebar"><a class="btn ghost" href="#heartbeats">Back to heartbeats</a><a class="btn primary" href="#heartbeats">Done</a></div>' +
      "</div>"
    );
  }

  /* status page editor state */
  var SP = null;
  function spInit() {
    if (SP) return;
    var byName = {};
    ALL.forEach(function (e) { byName[e.s.name] = e.s; });
    var pub = { "API health": "API", "Web app": "Website", "Primary Postgres": "Database", "Replica Postgres": "Database replica", "Primary SSH": "Remote access", "Replica SSH": "Remote access, replica" };
    SP = V.sections.slice(0, 3).map(function (sec) {
      return { title: sec.title, items: sec.services.map(function (s) { return { name: s.name, kind: "Monitor", target: s.targetDisplay, k: s.kind, pub: pub[s.name] || s.name }; }) };
    });
  }
  function spCandidates() {
    var used = {};
    SP.forEach(function (sec) { sec.items.forEach(function (i) { used[i.name] = 1; }); });
    var mons = ALL.filter(function (e) { return !used[e.s.name]; }).map(function (e) { return { name: e.s.name, kind: "Monitor", target: e.s.targetDisplay, k: e.s.kind }; });
    var hbs = HEARTBEATS.filter(function (h) { return !used[h.name]; }).map(function (h) { return { name: h.name, kind: "Heartbeat", target: h.every, k: "push" }; });
    return mons.concat(hbs);
  }
  function kIcon(k) { return k === "push" ? "heart" : k === "port" ? "server" : k === "ping" ? "radar" : "globe"; }
  function spSection(sec, si) {
    var items = sec.items.map(function (it, ii) {
      return (
        '<li class="svc" draggable="true" data-si="' + si + '" data-ii="' + ii + '">' +
          '<button class="grip" type="button" aria-label="Move ' + esc(it.name) + ', use the up and down arrow keys" data-grip>' + ic("grip") + "</button>" +
          '<span class="src"><span class="k" aria-hidden="true">' + ic(kIcon(it.k)) + "</span><span><b>" + esc(it.name) + "</b><small>" + esc(it.kind) + " · " + esc(it.target || "") + "</small></span></span>" +
          '<span class="pub"><label for="pub-' + si + "-" + ii + '">Public name</label><input id="pub-' + si + "-" + ii + '" class="input" value="' + esc(it.pub || it.name) + '"></span>' +
          '<button class="btn sm icon ghost rm" type="button" aria-label="Remove ' + esc(it.name) + ' from the page" data-rm="' + si + ":" + ii + '">' + ic("x") + "</button>" +
        "</li>"
      );
    }).join("");
    return (
      '<section class="card sec-card" aria-label="Section ' + esc(sec.title) + '">' +
        '<div class="card-h"><label class="sr-only" for="sec-' + si + '">Section name</label><input id="sec-' + si + '" class="input" value="' + esc(sec.title) + '"><span class="muted small" style="margin-left:auto">' + sec.items.length + " on the page</span>" +
        '<button class="btn sm icon ghost" type="button" aria-label="Delete section ' + esc(sec.title) + '" data-rmsec="' + si + '">' + ic("trash") + "</button></div>" +
        '<ul class="svc-list" data-list="' + si + '">' + items + "</ul>" +
        '<div class="picker"><div class="input-wrap">' + ic("search") +
          '<input class="input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="lb-' + si + '" aria-label="Search monitors and heartbeats to add to ' + esc(sec.title) + '" placeholder="Search monitors to add" data-pick="' + si + '"></div>' +
          '<div class="listbox" role="listbox" id="lb-' + si + '" aria-label="Monitors and heartbeats" hidden></div>' +
        "</div>" +
      "</section>"
    );
  }
  function spListbox(si, q) {
    var c = spCandidates().filter(function (x) { return !q || x.name.toLowerCase().indexOf(q.toLowerCase()) >= 0; });
    if (!c.length) return '<div class="none">Everything matching is already on the page.</div>';
    var out = "";
    ["Monitor", "Heartbeat"].forEach(function (kind) {
      var g = c.filter(function (x) { return x.kind === kind; });
      if (!g.length) return;
      out += '<div class="grp" role="presentation">' + kind + "s</div>";
      out += g.map(function (x) { return '<div role="option" tabindex="-1" aria-selected="false" data-add="' + si + '" data-name="' + esc(x.name) + '">' + ic(kIcon(x.k)) + "<span>" + esc(x.name) + "</span><small>" + esc(x.target || "") + "</small></div>"; }).join("");
    });
    return out;
  }
  function screenStatusPage() {
    spInit();
    var cand = spCandidates();
    var nMon = cand.filter(function (x) { return x.kind === "Monitor"; }).length;
    var nHb = cand.length - nMon;
    return (
      '<div class="page narrow">' +
        titleRow("Status page", "What your customers see at " + esc(V.site.hostnames[0]) + ".", '<a class="btn" href="#status-page">' + ic("ext") + 'View page</a><button class="btn primary" type="button" data-toast="Status page saved and published">Save</button>') +
        '<section class="group" aria-labelledby="sp1">' +
          '<div class="explain"><h2 id="sp1">Sections</h2><p>Group what you watch the way customers think about it. Drag to reorder. The public name is what visitors read.</p><p style="margin-top:10px" class="small">Not on the page yet: ' + nMon + " monitors, " + nHb + " heartbeats.</p></div>" +
          '<div id="spSecs" style="min-width:0">' + SP.map(spSection).join("") +
            '<button class="btn" type="button" id="addSec">' + ic("plus") + "Add section</button></div>" +
        "</section>" +
        '<section class="group" aria-labelledby="sp2">' +
          '<div class="explain"><h2 id="sp2">Look</h2><p>Pick a theme. Your logo and colours come later under Branding.</p></div>' +
          '<div class="fields"><fieldset><legend>Theme</legend><div class="themes">' +
            THEMES.map(function (t, i) {
              return '<label class="theme-opt"><input type="radio" name="theme" value="' + i + '"' + (i === 3 ? " checked" : "") + '><span class="tc"><span class="sw" style="background:' + t.c[0] + ';border:1px solid ' + t.c[2] + '"><i style="background:' + t.c[1] + ';width:40%"></i><i style="background:' + t.c[2] + '"></i><i style="background:' + t.c[2] + ';width:70%"></i></span><span class="tn">' + esc(t.name) + ic("checkc") + "</span></span></label>";
            }).join("") +
          "</div></fieldset></div>" +
        "</section>" +
        '<section class="group" aria-labelledby="sp3">' +
          '<div class="explain"><h2 id="sp3">Who can see it</h2><p>Private pages ask visitors to sign in first.</p></div>' +
          '<div class="fields"><fieldset><legend class="sr-only">Visibility</legend><div class="radio-cards">' +
            '<label><input type="radio" name="vis" checked><span><b>' + ic("globe") + " Public</b><small>Anyone with the link.</small></span></label>" +
            '<label><input type="radio" name="vis"><span><b>' + ic("lock") + " Private</b><small>Only people you invite.</small></span></label>" +
          '</div></fieldset><div class="field" style="margin-top:16px"><span class="label" id="lnk-l">Address</span><div class="codebox" aria-labelledby="lnk-l"><code id="splink">https://' + esc(V.site.hostnames[0]) + '</code><button class="btn" type="button" data-copy="splink">' + ic("copy") + 'Copy</button></div></div></div>' +
        "</section>" +
      "</div>"
    );
  }

  function screenAlerts() {
    var rows = CHANNELS.map(function (c) {
      var t = typeOf(c.type);
      return (
        '<li class="crow">' +
          '<div class="who"><span class="ch-ico" aria-hidden="true">' + ic(t.icon) + "</span><span><b>" + esc(c.name) + "</b><small>" + esc(t.name) + " · " + esc(c.dest) + "</small></span></div>" +
          '<div><span class="sr-only">Sends: </span><div class="chips">' + c.events.map(function (e) { return '<span class="pill">' + esc(e) + "</span>"; }).join("") + '</div><span class="muted small">' + esc(c.last) + "</span></div>" +
          '<div class="acts"><button class="btn sm" type="button" data-toast="Test alert sent to ' + esc(c.name) + '">' + ic("send") + 'Send test</button><button class="btn sm icon ghost" type="button" aria-label="Edit ' + esc(c.name) + '" data-toast="Editing is the same form as Add channel">' + ic("pencil") + "</button></div>" +
        "</li>"
      );
    }).join("");
    return (
      '<div class="page narrow">' +
        titleRow("Alerts", "Where we tell you when something goes down and comes back.", '<button class="btn primary" type="button" id="addCh" aria-expanded="false" aria-controls="newch">' + ic("plus") + "Add channel</button>") +
        '<section class="card" id="newch" hidden aria-labelledby="nc-h" style="margin-bottom:18px"><div class="card-h"><h2 id="nc-h">Add a channel</h2><button class="btn sm icon ghost" type="button" id="closeCh" aria-label="Close">' + ic("x") + "</button></div><div class=\"card-b\">" +
          '<fieldset><legend>Type</legend><div class="type-grid">' + TYPES.map(function (t, i) {
            return '<label><input type="radio" name="nctype" value="' + t.id + '"' + (i === 0 ? " checked" : "") + ">" + ic(t.icon) + t.name + "</label>";
          }).join("") + "</div></fieldset>" +
          '<div class="row2" style="margin-top:16px"><div class="field"><label for="ncname">Name</label><input id="ncname" class="input" placeholder="For example On-call"></div>' +
          '<div class="field"><label for="ncval" id="ncval-l">Email address</label><input id="ncval" class="input" type="email" placeholder="you@example.com"></div></div>' +
          '<fieldset class="field" style="margin-top:16px"><legend>Send when</legend><div class="checks" style="flex-direction:row;flex-wrap:wrap;gap:10px 20px">' +
            '<label class="check"><input type="checkbox" checked>Down</label><label class="check"><input type="checkbox" checked>Back up</label><label class="check"><input type="checkbox">Data went quiet</label><label class="check"><input type="checkbox">Data is back</label></div></fieldset>' +
          '<div class="test-row"><button class="btn" type="button" data-toast="Test alert sent">' + ic("send") + 'Send a test</button><button class="btn primary" type="button" id="saveCh">Save channel</button></div>' +
        "</div></section>" +
        '<ul class="rows" aria-label="Alert channels">' + rows + "</ul>" +
        '<section style="margin-top:28px" aria-labelledby="dl-h"><h2 id="dl-h" style="margin-bottom:10px">Recent deliveries</h2><div class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>What</th><th class="hide-sm">Channel</th><th>Result</th></tr></thead><tbody>' +
          [["2 days ago", "Replica Postgres is back up", "Ops alerts", "up"], ["2 days ago", "Replica Postgres is down", "Ops alerts", "up"], ["2 days ago", "Replica Postgres is down", "On-call inbox", "up"], ["5 days ago", "Test alert", "Engineering", "up"]].map(function (r) {
            return "<tr><td>" + r[0] + "</td><td>" + esc(r[1]) + '</td><td class="hide-sm">' + esc(r[2]) + '</td><td><span class="st st-up">' + ic("checkc") + "Delivered</span></td></tr>";
          }).join("") +
        "</tbody></table></div></div></section>" +
      "</div>"
    );
  }

  var CONFIG_JSON = JSON.stringify({
    site: { name: V.site.name, hostnames: V.site.hostnames },
    theme: "classic",
    sections: [
      { title: "Web", services: ["api-health", "web-app"] },
      { title: "Database", services: ["primary-postgres", "replica-postgres"] }
    ],
    displayNames: { "api-health": "API", "web-app": "Website" },
    channels: [{ name: "Ops alerts", type: "discord", events: ["down", "up", "stale"] }]
  }, null, 2);

  function screenSettings() {
    var secs = [
      ["set-sources", "Sources and keys"], ["set-users", "Users and invites"], ["set-rev", "Revisions"], ["set-io", "Import and export"], ["set-adv", "Advanced"]
    ];
    return (
      '<div class="page">' +
        titleRow("Settings", "Everything else, including the power tools.") +
        '<div class="settings">' +
          '<nav class="subnav" aria-label="Settings sections">' + secs.map(function (s, i) { return '<button type="button" data-jump="' + s[0] + '"' + (i === 0 ? ' aria-current="true"' : "") + ">" + s[1] + "</button>"; }).join("") + "</nav>" +
          "<div>" +
            '<section class="set-sec" id="set-sources" aria-labelledby="ss-h"><h2 id="ss-h">Sources and keys</h2><p>Where check results come from. Agents and scripts sign in with a key.</p><div class="card">' +
              lrow("globe", "Cloudflare edge", "Built in. Runs your monitors from the nearest data centre.", st("up"), "") +
              lrow("server", "Frankfurt rack agent", "Agent on your own server. Last report 34 s ago.", st("up"), '<button class="btn sm" type="button" data-toast="Key rotated. Update the agent within 24 hours.">Rotate key</button>') +
              lrow("swap", "Office Uptime Kuma", "Sends results from an existing Uptime Kuma. Last report 34 s ago.", st("up"), '<button class="btn sm" type="button" data-toast="Key rotated">Rotate key</button>') +
              lrow("code", "Deploy script facts", "Pushes version and build facts every 15 minutes. Last report 13 min ago.", st("up"), '<button class="btn sm" type="button" data-toast="Key rotated">Rotate key</button>') +
            '</div><div style="margin-top:12px"><button class="btn" type="button" data-toast="New key created. Copy it now, it is shown once.">' + ic("key") + "Create key</button></div></section>" +
            '<section class="set-sec" id="set-users" aria-labelledby="su-h"><h2 id="su-h">Users and invites</h2><p>People who can see or change this site.</p><div class="card">' +
              lrow(null, "Dana Reyes", "dana@example.com", '<span class="pill accent">Owner</span>', "", "DR") +
              lrow(null, "Sam Okafor", "sam@example.com", '<span class="pill">Admin</span>', '<button class="btn sm ghost" type="button">Change</button>', "SO") +
              lrow(null, "Lee Moreau", "lee@example.org", '<span class="pill">Viewer</span>', '<button class="btn sm ghost" type="button">Change</button>', "LM") +
              lrow("mail", "kit@example.org", "Invited 2 days ago, not accepted yet", '<span class="pill">Invite pending</span>', '<button class="btn sm ghost" type="button" data-toast="Invite sent again">Resend</button>') +
            '</div><form class="card card-b" style="margin-top:12px" onsubmit="return false"><div class="row3" style="align-items:end"><div class="field" style="grid-column:span 2"><label for="inv">Invite by email</label><input id="inv" class="input" type="email" placeholder="colleague@example.com"></div><div class="field"><label for="role">Role</label><select id="role" class="input"><option>Viewer</option><option>Admin</option></select></div></div><div style="margin-top:12px"><button class="btn primary" type="button" data-toast="Invite sent">Send invite</button></div></form></section>' +
            '<section class="set-sec" id="set-rev" aria-labelledby="sr-h"><h2 id="sr-h">Revisions</h2><p>Every save is kept. Restore any earlier version.</p><div class="card">' +
              [["Today, 09:12", "Dana Reyes", "Renamed Web app to Website on the status page"], ["Yesterday, 17:40", "Sam Okafor", "Added Replica SSH"], ["Sep 24, 11:03", "Dana Reyes", "New alert channel: Engineering"], ["Sep 20, 08:55", "Dana Reyes", "Imported from Uptime Kuma"]].map(function (r, i) {
                return lrow("history", r[2], r[0] + " by " + r[1], i === 0 ? '<span class="pill accent">Current</span>' : "", i === 0 ? "" : '<button class="btn sm" type="button" data-toast="Restored. Undo from the newest revision.">Restore</button>');
              }).join("") +
            "</div></section>" +
            '<section class="set-sec" id="set-io" aria-labelledby="si-h"><h2 id="si-h">Import and export</h2><p>Move in from Uptime Kuma, or take everything with you.</p><div class="card">' +
              lrow("swap", "Import from Uptime Kuma", "Upload a backup file. You review what comes in before anything changes.", "", '<label class="btn sm" for="kumafile">Choose file</label><input id="kumafile" type="file" class="sr-only" accept=".json">') +
              lrow("code", "Export everything", "One JSON file with monitors, sections, channels and settings. No secrets.", "", '<button class="btn sm" type="button" data-toast="Export downloaded">Download</button>') +
            "</div></section>" +
            '<section class="set-sec" id="set-adv" aria-labelledby="sa-h"><h2 id="sa-h">Advanced: edit as JSON</h2><p>The whole site as one document. Checked before it saves; a mistake never goes live.</p>' +
              '<div class="card card-b"><label for="json" class="sr-only">Site settings as JSON</label><textarea id="json" class="input json" spellcheck="false" rows="16">' + esc(CONFIG_JSON) + '</textarea>' +
              '<div class="test-row"><span class="st st-up">' + ic("checkc") + 'Valid</span><span style="margin-left:auto"></span><button class="btn" type="button" data-toast="Changes discarded">Discard</button><button class="btn primary" type="button" data-toast="Saved as a new revision">Save</button></div></div></section>' +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }
  function lrow(icon, title, sub, badge, action, initials) {
    return '<div class="lrow">' + (initials ? '<span class="avatar" aria-hidden="true">' + initials + "</span>" : '<span class="ch-ico" aria-hidden="true">' + ic(icon) + "</span>") +
      '<div class="grow"><b>' + esc(title) + "</b><span>" + esc(sub) + "</span></div>" + (badge || "") + (action || "") + "</div>";
  }

  function screenIncidents() {
    var list = VI.incidents.open.concat(VI.incidents.recent).slice(0, 8).map(function (i) {
      return "<li>" + (i.endedAt ? st("up") : st("down")) + '<div class="inc-b"><b>' + esc(i.title) + "</b><span>" + day(i.startedAt) + " UTC, " + (i.endedAt ? "resolved after " + dur(i.durationS) : "ongoing, " + dur(i.durationS)) + "</span></div></li>";
    }).join("");
    return '<div class="page narrow">' + titleRow("Incidents", "Opened and closed automatically from your checks.") + '<section class="card" aria-label="Incidents"><ul class="inc-list">' + list + "</ul></section></div>";
  }

  function screenFirstRun() {
    return (
      '<div class="bare">' +
        '<header class="bare-top"><div class="brand" style="padding:0"><span class="mark">' + ic("logo") + '</span>Uptellis</div><a class="small" href="#monitors-empty">Skip for now</a></header>' +
        '<main id="main" tabindex="-1" class="welcome">' +
          '<p class="eyebrow">Welcome, Dana</p>' +
          "<h1>What should we watch?</h1>" +
          '<p class="lead">Paste a website or API. We check it every minute and tell you the moment it goes down.</p>' +
          '<form class="card" id="frForm" novalidate><div class="card-b">' +
            '<div class="field"><label for="frurl">URL to monitor</label><input id="frurl" class="input lg" type="text" inputmode="url" placeholder="https://example.com" autocomplete="off" aria-describedby="frurl-h"><span class="hint" id="frurl-h">A website, an API, or a host and port like example.com:5432.</span></div>' +
            "<h2>Where should we alert you?</h2>" +
            '<fieldset><legend class="sr-only">Alert channel</legend><div class="type-grid six">' +
              TYPES.filter(function (t) { return t.id !== "ntfy"; }).map(function (t, i) {
                return '<label><input type="radio" name="frch" value="' + t.id + '"' + (i === 0 ? " checked" : "") + ">" + ic(t.icon) + t.name + "</label>";
              }).join("") +
            "</div></fieldset>" +
            '<div class="field" style="margin-top:16px"><label for="frval" id="frval-l">Email address</label><input id="frval" class="input" type="email" placeholder="you@example.com"></div>' +
            '<div class="test-row"><button class="btn" type="button" id="frTest">' + ic("send") + 'Send a test alert</button><span class="res" id="frRes">' + ic("checkc") + "Sent. Check that it arrived.</span></div>" +
            '<div class="go-row"><span class="muted small">Every minute, from Cloudflare edge. Change it any time.</span><button class="btn primary" type="submit">Start monitoring</button></div>' +
          "</div></form>" +
          '<section class="next" aria-labelledby="nx"><h2 id="nx">Then, from your dashboard</h2><ol>' +
            '<li class="here"><span class="n">1</span>Add your first monitor</li><li class="here"><span class="n">2</span>Choose where alerts go</li>' +
            '<li><span class="n">3</span>Invite colleagues</li><li><span class="n">4</span>Publish your status page</li>' +
          "</ol></section>" +
        "</main>" +
      "</div>"
    );
  }

  /* ---------------- router ---------------- */
  var SCREENS = {
    "first-run": { t: "Welcome", r: screenFirstRun, bare: true },
    monitors: { t: "Monitors", r: screenMonitors },
    "monitors-empty": { t: "Monitors", r: screenMonitorsEmpty },
    "create-monitor": { t: "New monitor", r: screenCreateMonitor },
    monitor: { t: "Monitor", r: screenMonitor },
    "monitor-pending": { t: "shop.example.com", r: screenMonitorPending },
    heartbeats: { t: "Heartbeats", r: screenHeartbeats },
    "create-heartbeat": { t: "New heartbeat", r: screenCreateHeartbeat },
    "status-page": { t: "Status page", r: screenStatusPage },
    alerts: { t: "Alerts", r: screenAlerts },
    settings: { t: "Settings", r: screenSettings },
    incidents: { t: "Incidents", r: screenIncidents }
  };
  var first = true;
  var pendTimer = null;
  function render() {
    var route = (location.hash || "").replace(/^#/, "") || "monitors";
    var sc = SCREENS[route] || SCREENS.monitors;
    if (!SCREENS[route]) route = "monitors";
    var root = $("#root");
    root.innerHTML = sc.bare ? sc.r() : shell(route, sc.r());
    document.title = sc.t + " · Uptellis";
    document.body.classList.remove("drawer");
    if (!first) { var m = $("#main"); if (m) m.focus({ preventScroll: true }); window.scrollTo(0, 0); }
    first = false;
    clearTimeout(pendTimer);
    wire(route);
  }

  function toast(msg) {
    var box = $("#toasts");
    var t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = ic("checkc") + "<span>" + esc(msg) + "</span>";
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 4200);
  }

  function wire(route) {
    var menuBtn = $("#menuBtn");
    if (menuBtn) {
      menuBtn.addEventListener("click", function () {
        var open = document.body.classList.toggle("drawer");
        menuBtn.setAttribute("aria-expanded", String(open));
        if (open) { var a = $("#sidebar a"); if (a) a.focus(); }
      });
      $("#scrim").addEventListener("click", function () { document.body.classList.remove("drawer"); menuBtn.setAttribute("aria-expanded", "false"); });
    }

    if (route === "monitors") {
      var q = $("#q");
      q.addEventListener("input", function () {
        var v = q.value.toLowerCase(), shown = 0;
        $$("#mlist > li").forEach(function (li) { var hit = li.textContent.toLowerCase().indexOf(v) >= 0; li.hidden = !hit; if (hit) shown++; });
        $("#nores").hidden = shown > 0;
      });
    }

    if (route === "create-monitor") {
      var url = $("#url"), nm = $("#mname"), touched = false;
      nm.addEventListener("input", function () { touched = true; });
      url.addEventListener("input", function () {
        var t = inferType(url.value);
        var r = $('input[name="ctype"][value="' + t + '"]'); if (r) r.checked = true;
        if (!touched) nm.value = hostOf(url.value);
      });
      $("#cmForm").addEventListener("submit", function (e) { e.preventDefault(); location.hash = "#monitor-pending"; setTimeout(function () { toast("Monitor created. First check is on its way."); }, 30); });
    }

    if (route === "monitor-pending") {
      toast("Monitor created. First check is on its way.");
      pendTimer = setTimeout(function () {
        var b = $("#pbanner"); if (!b) return;
        b.className = "banner"; b.style.borderColor = "var(--border)"; b.style.background = "var(--up-soft)";
        b.innerHTML = ic("checkc") + '<div class="b-body"><b>First check passed</b><span>200 OK in 184 ms. We keep checking every minute.</span></div><a class="btn sm" href="#monitors">Go to dashboard</a>';
        $("#pstate").innerHTML = st("up");
        $("#pbig").className = "big-state up"; $("#pbig").innerHTML = ic("checkc");
        $("#pchecks").innerHTML = '<table class="tbl"><tbody><tr><td>' + st("up") + '</td><td>just now</td><td class="r">184 ms</td><td>200 - OK</td></tr></tbody></table>';
      }, 9000);
    }

    if (route === "status-page") wireStatusPage();

    if (route === "alerts") {
      var add = $("#addCh"), box = $("#newch");
      add.addEventListener("click", function () { box.hidden = false; add.setAttribute("aria-expanded", "true"); $('input[name="nctype"]:checked').focus(); });
      $("#closeCh").addEventListener("click", function () { box.hidden = true; add.setAttribute("aria-expanded", "false"); add.focus(); });
      $("#saveCh").addEventListener("click", function () { box.hidden = true; add.setAttribute("aria-expanded", "false"); toast("Channel saved"); });
      bindType("nctype", "#ncval", "#ncval-l");
    }

    if (route === "first-run") {
      bindType("frch", "#frval", "#frval-l");
      $("#frTest").addEventListener("click", function () {
        var t = typeOf($('input[name="frch"]:checked').value);
        $("#frRes").classList.add("show");
        toast("Test alert sent by " + t.name);
      });
      $("#frForm").addEventListener("submit", function (e) {
        e.preventDefault();
        location.hash = "#monitor-pending";
      });
    }

    if (route === "settings") {
      $$("[data-jump]").forEach(function (b) {
        b.addEventListener("click", function () {
          $$("[data-jump]").forEach(function (x) { x.removeAttribute("aria-current"); });
          b.setAttribute("aria-current", "true");
          var t = document.getElementById(b.getAttribute("data-jump"));
          t.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
          var h = t.querySelector("h2"); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); }
        });
      });
    }
  }

  function bindType(name, valSel, labSel) {
    $$('input[name="' + name + '"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var t = typeOf(r.value);
        $(labSel).textContent = t.field;
        var v = $(valSel); v.type = t.input; v.placeholder = t.ph; v.value = "";
      });
    });
  }

  function wireStatusPage() {
    var wrap = $("#spSecs");
    function redraw(focusSel) {
      root(); if (focusSel) { var f = $(focusSel); if (f) f.focus(); }
    }
    function root() { location.hash === "#status-page" && ($("#root").innerHTML = shell("status-page", screenStatusPage())) && wireStatusPage(); }
    function syncNames() {
      SP.forEach(function (sec, si) {
        var t = $("#sec-" + si); if (t) sec.title = t.value;
        sec.items.forEach(function (it, ii) { var p = $("#pub-" + si + "-" + ii); if (p) it.pub = p.value; });
      });
    }
    wrap.addEventListener("click", function (e) {
      var rm = e.target.closest("[data-rm]");
      if (rm) { syncNames(); var p = rm.getAttribute("data-rm").split(":"); var gone = SP[+p[0]].items.splice(+p[1], 1)[0]; redraw(); toast(gone.name + " removed from the page"); return; }
      var rs = e.target.closest("[data-rmsec]");
      if (rs) { syncNames(); var g = SP.splice(+rs.getAttribute("data-rmsec"), 1)[0]; redraw(); toast("Section " + g.title + " deleted"); return; }
      var opt = e.target.closest("[data-add]");
      if (opt) { addItem(+opt.getAttribute("data-add"), opt.getAttribute("data-name")); }
    });
    function addItem(si, name) {
      syncNames();
      var c = spCandidates().filter(function (x) { return x.name === name; })[0];
      if (!c) return;
      c.pub = c.name;
      SP[si].items.push(c);
      redraw('[data-pick="' + si + '"]');
      toast(name + " added to " + SP[si].title);
    }
    $("#addSec").addEventListener("click", function () {
      syncNames();
      SP.push({ title: "New section", items: [] });
      redraw("#sec-" + (SP.length - 1));
    });
    $$("[data-pick]").forEach(function (inp) {
      var si = +inp.getAttribute("data-pick");
      var lb = $("#lb-" + si);
      function open() { lb.innerHTML = spListbox(si, inp.value); lb.hidden = false; inp.setAttribute("aria-expanded", "true"); }
      function close() { lb.hidden = true; inp.setAttribute("aria-expanded", "false"); }
      inp.addEventListener("focus", open);
      inp.addEventListener("input", open);
      inp.addEventListener("keydown", function (e) {
        var opts = $$('[role="option"]', lb), cur = opts.findIndex(function (o) { return o.getAttribute("aria-selected") === "true"; });
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault(); if (lb.hidden) open(); opts = $$('[role="option"]', lb);
          if (!opts.length) return;
          var n = e.key === "ArrowDown" ? Math.min(opts.length - 1, cur + 1) : Math.max(0, cur - 1);
          opts.forEach(function (o, i) { o.setAttribute("aria-selected", String(i === n)); });
          opts[n].id = "opt-" + si + "-" + n; inp.setAttribute("aria-activedescendant", opts[n].id);
        } else if (e.key === "Enter") {
          e.preventDefault(); var pick = opts[cur >= 0 ? cur : 0]; if (pick) addItem(si, pick.getAttribute("data-name"));
        } else if (e.key === "Escape") close();
      });
      inp.addEventListener("blur", function () { setTimeout(close, 150); });
    });
    // drag and keyboard reorder
    var drag = null;
    $$(".svc").forEach(function (li) {
      li.addEventListener("dragstart", function (e) { drag = li; li.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", ""); });
      li.addEventListener("dragend", function () { li.classList.remove("dragging"); $$(".svc.over").forEach(function (x) { x.classList.remove("over"); }); });
      li.addEventListener("dragover", function (e) { if (drag && drag.dataset.si === li.dataset.si) { e.preventDefault(); li.classList.add("over"); } });
      li.addEventListener("dragleave", function () { li.classList.remove("over"); });
      li.addEventListener("drop", function (e) {
        e.preventDefault(); if (!drag || drag === li) return;
        syncNames(); move(+drag.dataset.si, +drag.dataset.ii, +li.dataset.ii);
      });
    });
    $$("[data-grip]").forEach(function (g) {
      g.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault(); syncNames();
        var li = g.closest(".svc"), si = +li.dataset.si, ii = +li.dataset.ii;
        var to = e.key === "ArrowUp" ? ii - 1 : ii + 1;
        if (to < 0 || to >= SP[si].items.length) return;
        move(si, ii, to, true);
      });
    });
    function move(si, from, to, kb) {
      var it = SP[si].items.splice(from, 1)[0];
      SP[si].items.splice(to, 0, it);
      redraw(kb ? '[data-si="' + si + '"][data-ii="' + to + '"] [data-grip]' : null);
      toast(it.name + " moved to position " + (to + 1));
    }
  }

  /* ---------------- global handlers ---------------- */
  document.addEventListener("click", function (e) {
    var sk = e.target.closest(".skip");
    if (sk) { e.preventDefault(); var m = $("#main"); if (m) m.focus(); return; }
    var t = e.target.closest("[data-toast]");
    if (t) { var d = t.closest("details"); if (d) d.open = false; toast(t.getAttribute("data-toast")); }
    var c = e.target.closest("[data-copy]");
    if (c) {
      var txt = document.getElementById(c.getAttribute("data-copy")).textContent;
      try { navigator.clipboard.writeText(txt).catch(function () {}); } catch (err) { /* file:// may block clipboard */ }
      toast("Copied to clipboard");
    }
    if (document.body.classList.contains("drawer") && e.target.closest("#sidebar a")) document.body.classList.remove("drawer");
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && document.body.classList.contains("drawer")) {
      document.body.classList.remove("drawer");
      var b = $("#menuBtn"); if (b) { b.setAttribute("aria-expanded", "false"); b.focus(); }
    }
  });
  window.addEventListener("hashchange", render);
  render();
})();
