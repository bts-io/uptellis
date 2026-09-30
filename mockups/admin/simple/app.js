/* Uptellis admin mock-up, direction "simple". One dashboard; create, edit, detail and heartbeat flows are drawers.
   Monitors come from the real SiteView (window.UPTELLIS_DEMO.incident); heartbeats, channels, users, keys and
   revisions are invented below. Internal ids never reach the page: rows are keyed by a slug of the name. */
(function () {
  "use strict";

  var DEMO = window.UPTELLIS_DEMO;
  var V = DEMO.incident;
  var NOW = Date.parse(V.now);
  var SITE = V.site.name;

  /* ---------------- helpers ---------------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function pct(r) {
    if (r == null) return "No data";
    if (r >= 1) return "100%";
    return (Math.floor(r * 10000) / 100).toFixed(2) + "%";
  }
  function ago(sec) {
    if (sec == null) return "never";
    if (sec < 60) return Math.round(sec) + " s ago";
    if (sec < 3600) return Math.round(sec / 60) + " min ago";
    if (sec < 86400) return Math.round(sec / 3600) + " h ago";
    return Math.round(sec / 86400) + " days ago";
  }
  function dur(sec) {
    if (sec < 60) return Math.round(sec) + " seconds";
    if (sec < 3600) { var m = Math.round(sec / 60); return m + (m === 1 ? " minute" : " minutes"); }
    if (sec < 86400) { var h = Math.round(sec / 3600); return h + (h === 1 ? " hour" : " hours"); }
    var d = Math.round(sec / 86400); return d + (d === 1 ? " day" : " days");
  }
  function every(sec) {
    if (sec < 60) return "every " + sec + " seconds";
    if (sec === 60) return "every minute";
    if (sec < 3600) return "every " + sec / 60 + " minutes";
    if (sec === 3600) return "every hour";
    if (sec === 86400) return "every day";
    return "every " + dur(sec);
  }
  function hhmm(ts) { return ts.slice(11, 16); }
  function hhmmss(ts) { return ts.slice(11, 19); }
  function ms(n) { return n == null ? "No reply" : Math.round(n) + " ms"; }
  // Deterministic pseudo-random numbers so the mock looks the same on every load.
  var seed = 7;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  /* ---------------- icons ---------------- */
  var P = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    up: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.7L16.5 9.5"/>',
    down: '<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
    paused: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
    pending: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    degraded: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    maintenance: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z"/>',
    stale: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    http: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    tcp: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/>',
    ping: '<path d="M4.9 19.1a10 10 0 0 1 0-14.2M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M19.1 4.9a10 10 0 0 1 0 14.2"/><circle cx="12" cy="12" r="2"/>',
    tls: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    heartbeat: '<path d="M19.5 12.6 12 20l-7.5-7.4A5 5 0 1 1 12 6a5 5 0 1 1 7.5 6.6z"/><path d="M6 12h3l1.5-2.5 2.5 5 1.5-2.5H18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    grip: '<circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
    email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    discord: '<path d="M8 17c-2 0-4-.5-5-1.5 0-5 1.5-9 3-10.5 1.5-.7 3-1 4-1l.5 1.2h3L14 4c1 0 2.5.3 4 1 1.5 1.5 3 5.5 3 10.5-1 1-3 1.5-5 1.5l-1-2"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/>',
    slack: '<path d="M14.5 10c-.8 0-1.5-.7-1.5-1.5v-5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5v5c0 .8-.7 1.5-1.5 1.5zM20.5 10H19V8.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5-.7 1.5-1.5 1.5zM9.5 14c.8 0 1.5.7 1.5 1.5v5c0 .8-.7 1.5-1.5 1.5S8 21.3 8 20.5v-5c0-.8.7-1.5 1.5-1.5zM3.5 14H5v1.5c0 .8-.7 1.5-1.5 1.5S2 16.3 2 15.5 2.7 14 3.5 14zM14 14.5c0-.8.7-1.5 1.5-1.5h5c.8 0 1.5.7 1.5 1.5s-.7 1.5-1.5 1.5h-5c-.8 0-1.5-.7-1.5-1.5zM10 9.5C10 8.7 9.3 8 8.5 8h-5C2.7 8 2 8.7 2 9.5S2.7 11 3.5 11h5c.8 0 1.5-.7 1.5-1.5z"/>',
    telegram: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    sms: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
    webhook: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    ntfy: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
    pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    play: '<path d="m6 4 14 8-14 8z"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
    key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l4 2"/>',
    swap: '<path d="M7 16V4M3 8l4-4 4 4M17 8v12M21 16l-4 4-4-4"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a4.5 4.5 0 1 1 0 9z"/>',
    server: '<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>'
  };
  function ico(name, cls) {
    return '<svg class="i ' + (cls || "") + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (P[name] || "") + "</svg>";
  }

  var STATE = {
    up: "Up", down: "Down", degraded: "Slow", paused: "Paused", pending: "Pending",
    maintenance: "Maintenance", stale: "No recent data", unknown: "Unknown"
  };
  function pill(state, big) {
    var s = STATE[state] ? state : "unknown";
    var icon = s === "unknown" ? "stale" : s;
    return '<span class="state s-' + s + (big ? " state-lg" : "") + '">' + ico(icon) + STATE[s] + "</span>";
  }
  var KIND = { http: "HTTP", tcp: "TCP", ping: "Ping", tls: "TLS", heartbeat: "Heartbeat" };
  function kindIco(kind) { return '<span class="kind-ico' + (kind === "heartbeat" ? " hb" : "") + '">' + ico(kind) + "</span>"; }

  /* ---------------- data ---------------- */
  var AGENTS = ["Berlin office", "Home lab"];
  var CHANNELS = [
    { type: "email", name: "On-call inbox", dest: "oncall@example.com", events: ["down", "up", "stale", "recovered"], scope: "All monitors", last: "6 min ago: Replica Postgres is down" },
    { type: "discord", name: "Acme Discord", dest: "#status-alerts channel", events: ["down", "up"], scope: "All monitors", last: "6 min ago: Replica Postgres is down" },
    { type: "slack", name: "Ops Slack", dest: "#ops channel", events: ["down", "up", "stale"], scope: "Web and Database sections", last: "6 min ago: Replica Postgres is down" },
    { type: "telegram", name: "Night shift group", dest: "@acme_nightshift", events: ["down"], scope: "All monitors", last: "3 days ago: Web app is down" }
  ];
  var EVENTS = { down: "Goes down", up: "Comes back up", stale: "Data goes silent", recovered: "Data is back" };
  var CH_TYPES = [
    { type: "email", label: "Email", field: "Email address", ph: "you@example.com", input: "email", hint: "We send from alerts@example.com." },
    { type: "discord", label: "Discord", field: "Discord webhook URL", ph: "https://discord.com/api/webhooks/...", input: "url", hint: "In Discord: Channel settings, Integrations, Webhooks, New webhook, Copy URL." },
    { type: "slack", label: "Slack", field: "Slack webhook URL", ph: "https://hooks.slack.com/services/...", input: "url", hint: "Add the Incoming Webhooks app to a channel and paste its URL." },
    { type: "telegram", label: "Telegram", field: "Chat or channel", ph: "@your_channel", input: "text", hint: "Add our bot to the chat first, then type the chat name." },
    { type: "sms", label: "SMS", field: "Phone number", ph: "+1 555 010 0199", input: "tel", hint: "Short texts for down and back up only." },
    { type: "webhook", label: "Webhook", field: "Webhook URL", ph: "https://example.org/hooks/uptime", input: "url", hint: "We POST a signed JSON body to this address." },
    { type: "ntfy", label: "ntfy", field: "Topic URL", ph: "https://ntfy.sh/acme-alerts", input: "url", hint: "A push notification on your phone through ntfy." }
  ];

  function kindOf(k) { return k === "port" ? "tcp" : (KIND[k] ? k : "http"); }
  function isPrivate(target) { return !target || !/\./.test(target.split(":")[0]); }
  function avg7(beats) {
    var last = beats.slice(-7).filter(function (b) { return b.uptime != null; });
    if (!last.length) return null;
    return last.reduce(function (a, b) { return a + b.uptime; }, 0) / last.length;
  }

  var PUBLIC_NAMES = { "API health": "Public API", "Web app": "Website", "Primary Postgres": "Database", "Replica Postgres": "Database replica", "Primary SSH": "SSH access", "Replica SSH": "SSH access (backup)", "Runner ping": "Build runners", "Runner SSH": "Build runner access" };

  var monitors = [];
  function addService(s, section) {
    var kind = kindOf(s.kind);
    var incs = V.incidents.open.concat(V.incidents.recent).filter(function (i) { return i.subject === s.name; });
    monitors.push({
      slug: slug(s.name), name: s.name, kind: kind, target: s.targetDisplay, state: s.state,
      latency: s.latencyMs, avgLatency: s.avgLatencyMs, up24: s.uptime24h, up7: avg7(s.beats90d), up30: s.uptime30d,
      beats: s.beats90d.slice(-30).map(function (b) { return b.worst || "none"; }),
      recent: s.recent, spark: s.spark, intervalS: s.intervalS || 60, cert: s.cert,
      runsOn: isPrivate(s.targetDisplay) ? (kind === "ping" ? AGENTS[1] : AGENTS[0]) : "Cloudflare edge",
      section: section, publicName: PUBLIC_NAMES[s.name] || s.name, incidents: incs,
      lastCheckS: s.recent.length ? Math.max(0, (NOW - Date.parse(s.recent[0].ts)) / 1000) : null
    });
  }
  V.sections.forEach(function (sec) { sec.services.forEach(function (s) { addService(s, sec.title); }); });
  V.unsectioned.forEach(function (s) { addService(s, null); });

  function synth(opts) {
    var beats = [], recent = [], spark = [];
    for (var i = 0; i < 30; i++) beats.push(opts.paused && i > 24 ? "paused" : (opts.badDay === i ? "down" : "up"));
    for (var j = 0; j < 48; j++) {
      var t = new Date(NOW - (j * (opts.intervalS || 60) + 20) * 1000).toISOString();
      var lat = opts.heartbeat ? null : Math.round(opts.base + rnd() * opts.base * 0.5);
      recent.push({ ts: t, status: "up", latencyMs: lat, message: opts.heartbeat ? "Ping received" : (opts.msg || "200 - OK"), important: false });
    }
    recent.slice().reverse().forEach(function (r) { if (r.latencyMs != null) spark.push(r.latencyMs); });
    return { beats: beats, recent: opts.paused ? [] : recent, spark: opts.paused ? [] : spark };
  }
  function invent(m, opts) {
    var s = synth(opts);
    monitors.push(Object.assign({
      slug: slug(m.name), beats: s.beats, recent: s.recent, spark: s.spark, incidents: [], cert: null,
      publicName: m.name, section: null, runsOn: "Cloudflare edge",
      lastCheckS: s.recent.length ? 20 : null,
      latency: s.spark.length ? s.spark[s.spark.length - 1] : null,
      avgLatency: s.spark.length ? Math.round(s.spark.reduce(function (a, b) { return a + b; }, 0) / s.spark.length) : null
    }, m));
  }
  invent({ name: "Certificate for example.com", kind: "tls", target: "example.com:443", state: "up", up24: 1, up7: 1, up30: 1, intervalS: 3600, note: "Valid for 73 more days" }, { base: 90, intervalS: 3600, msg: "Certificate valid, 73 days left" });
  invent({ name: "Staging site", kind: "http", target: "staging.example.org", state: "paused", up24: null, up7: 0.998, up30: 0.9981, intervalS: 300, note: "Paused 5 days ago by Priya Nair" }, { base: 240, paused: true, intervalS: 300 });
  invent({ name: "Nightly backup", kind: "heartbeat", target: "Expected every day, grace 1 hour", state: "up", up24: 1, up7: 1, up30: 0.9667, intervalS: 86400, grace: "1 hour", lastPingS: 6 * 3600 + 720 }, { heartbeat: true, intervalS: 86400, badDay: 17 });
  invent({ name: "Invoice sender", kind: "heartbeat", target: "Expected every 15 minutes, grace 5 minutes", state: "up", up24: 1, up7: 1, up30: 1, intervalS: 900, grace: "5 minutes", lastPingS: 250 }, { heartbeat: true, intervalS: 900 });
  invent({ name: "Search reindex", kind: "heartbeat", target: "Expected every hour, grace 10 minutes", state: "paused", up24: null, up7: 1, up30: 1, intervalS: 3600, grace: "10 minutes", lastPingS: 5 * 86400, note: "Paused while the search cluster moves" }, { heartbeat: true, intervalS: 3600, paused: true });

  var PENDING = { slug: "shop-example-org", name: "shop.example.org", kind: "http", target: "https://shop.example.org", state: "pending", up24: null, up7: null, up30: null, beats: [], recent: [], spark: [], intervalS: 60, incidents: [], publicName: "shop.example.org", runsOn: "Cloudflare edge", latency: null, lastCheckS: null, isNew: true };

  var app = { created: false, checklistHidden: false, opener: null, base: null };
  function all() { return app.created ? [PENDING].concat(monitors) : monitors; }
  function find(s) { return all().filter(function (m) { return m.slug === s; })[0]; }
  function defaultDetail() { return monitors.filter(function (m) { return m.state === "down"; })[0] || monitors[0]; }

  /* ---------------- dashboard ---------------- */
  function bars(m) {
    if (!m.beats.length) return '<span class="muted">No history yet</span>';
    var bad = m.beats.filter(function (b) { return b === "down"; }).length;
    var label = bad ? bad + (bad === 1 ? " day" : " days") + " with downtime in the last 30" : "No downtime in the last 30 days";
    if (m.state === "paused") label = "Paused for part of the last 30 days";
    return '<div class="bars" role="img" aria-label="' + label + '">' + m.beats.map(function (b) {
      return '<span class="bar b-' + b + '"></span>';
    }).join("") + "</div>";
  }
  function respText(m) {
    if (m.kind === "heartbeat") return m.state === "paused" ? "Paused" : "Pinged " + ago(m.lastPingS);
    if (m.state === "paused" || m.state === "pending") return "Waiting";
    return ms(m.latency);
  }
  function stats(list) {
    var up = 0, down = 0, paused = 0, u = [], downNames = [];
    list.forEach(function (m) {
      if (m.state === "up") up++;
      else if (m.state === "down") { down++; downNames.push(m.name); }
      else if (m.state === "paused") paused++;
      if (m.up30 != null && m.state !== "paused") u.push(m.up30);
    });
    var avg = u.length ? u.reduce(function (a, b) { return a + b; }, 0) / u.length : null;
    return '<section class="stats" aria-labelledby="stats-h"><h2 id="stats-h" class="sr-only">Overview</h2>' +
      '<div class="card stat up"><p class="stat-label">' + ico("up") + "Up</p><p class=\"stat-num\">" + up + '</p><p class="stat-sub">of ' + list.length + " watched</p></div>" +
      '<div class="card stat down' + (down ? " has" : "") + '"><p class="stat-label">' + ico("down") + "Down</p><p class=\"stat-num\">" + down + '</p><p class="stat-sub">' + (down ? esc(downNames.join(", ")) : "Nothing is down") + "</p></div>" +
      '<div class="card stat"><p class="stat-label">' + ico("paused") + "Paused</p><p class=\"stat-num\">" + paused + '</p><p class="stat-sub">Not being checked</p></div>' +
      '<div class="card stat"><p class="stat-label">' + ico("history") + "Uptime, last 30 days</p><p class=\"stat-num\">" + pct(avg) + '</p><p class="stat-sub">Average of everything running</p></div>' +
      "</section>";
  }
  function checklist() {
    if (app.checklistHidden) return "";
    var items = [
      { done: true, text: "Add your first monitor" },
      { done: true, text: "Send a test alert" },
      { done: false, text: "Add a heartbeat for a cron job", href: "#create-heartbeat" },
      { done: false, text: "Put monitors on your status page", href: "#status-page" },
      { done: false, text: "Invite a teammate", href: "#settings" }
    ];
    var done = items.filter(function (i) { return i.done; }).length;
    return '<section class="card checklist" aria-labelledby="cl-h"><div><h2 id="cl-h">Getting started</h2><p class="muted">' + done + " of " + items.length + ' done</p><div class="progress" role="progressbar" aria-label="Setup progress" aria-valuemin="0" aria-valuemax="' + items.length + '" aria-valuenow="' + done + '"><span style="width:' + (done / items.length * 100) + '%"></span></div></div>' +
      "<ol>" + items.map(function (i) {
        var tick = '<span class="tick' + (i.done ? " ok" : "") + '">' + (i.done ? ico("check") : "") + "</span>";
        return i.done ? '<li><span class="done">' + tick + esc(i.text) + '<span class="sr-only"> (done)</span></span></li>'
          : '<li><a href="' + i.href + '">' + tick + esc(i.text) + "</a></li>";
      }).join("") + '</ol><button type="button" class="btn btn-ghost btn-sm" data-action="hide-checklist">Hide</button></section>';
  }
  function inlineDetail(m) {
    var meta = [];
    if (m.kind === "heartbeat") {
      meta.push(ico("pending", "i-sm") + esc(m.target));
      meta.push(ico("heartbeat", "i-sm") + (m.state === "paused" ? "Last ping " + ago(m.lastPingS) : "Last ping " + ago(m.lastPingS)));
    } else {
      meta.push(ico("pending", "i-sm") + "Checked " + every(m.intervalS) + " from " + esc(m.runsOn));
      if (m.recent.length) meta.push(ico(m.recent[0].status === "up" ? "up" : "down", "i-sm") + "Last check " + ago(m.lastCheckS) + ": " + esc(m.recent[0].message || STATE[m.recent[0].status]));
    }
    if (m.note) meta.push(ico("info", "i-sm") + esc(m.note));
    if (m.incidents.length && !m.incidents[0].endedAt) meta.push(ico("degraded", "i-sm") + "Down since " + hhmm(m.incidents[0].startedAt) + " UTC (" + dur(m.incidents[0].durationS) + ")");
    var chart = m.spark.length ? sparkline(m.spark) : '<p class="muted">' + (m.kind === "heartbeat" ? "Heartbeats have no response time. Each ping just says \"I ran\"." : "No response times yet.") + "</p>";
    return '<div class="inline-detail"><div><h3>' + (m.kind === "heartbeat" ? "About this heartbeat" : "Response time, last " + m.spark.length + " checks") + "</h3>" + chart +
      '<ul class="inline-meta">' + meta.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul></div>" +
      '<div><h3>Uptime</h3><dl class="facts"><div><dt>24 hours</dt><dd>' + pct(m.up24) + "</dd></div><div><dt>7 days</dt><dd>" + pct(m.up7) + "</dd></div><div><dt>30 days</dt><dd>" + pct(m.up30) + "</dd></div></dl></div>" +
      '<div class="inline-actions"><a class="btn btn-primary btn-sm" href="#monitor/' + m.slug + '">Open details</a>' +
      '<a class="btn btn-secondary btn-sm" href="#edit-monitor/' + m.slug + '">' + ico("edit", "i-sm") + "Edit</a>" +
      '<button type="button" class="btn btn-secondary btn-sm" data-action="toast" data-msg="' + (m.state === "paused" ? "Resumed " : "Paused ") + esc(m.name) + '">' + ico(m.state === "paused" ? "play" : "pause", "i-sm") + (m.state === "paused" ? "Resume" : "Pause") + "</button>" +
      '<button type="button" class="btn btn-secondary btn-sm" data-action="toast" data-msg="Test alert sent to all channels for ' + esc(m.name) + '">' + ico("send", "i-sm") + "Send test alert</button></div></div>";
  }
  function sparkline(pts) {
    var W = 300, H = 64, max = Math.max.apply(null, pts), min = Math.min.apply(null, pts), span = (max - min) || 1;
    var d = pts.map(function (v, i) { return (i ? "L" : "M") + (i / (pts.length - 1) * W).toFixed(1) + " " + (H - 4 - (v - min) / span * (H - 8)).toFixed(1); }).join(" ");
    var avg = Math.round(pts.reduce(function (a, b) { return a + b; }, 0) / pts.length);
    return '<svg class="spark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="Response time: fastest ' + min + " ms, slowest " + max + " ms, average " + avg + ' ms"><path d="' + d + " L" + W + " " + H + " L0 " + H + ' Z" fill="currentColor" opacity=".1"/><path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>';
  }
  function row(m, open) {
    var id = "d-" + m.slug;
    return '<tr class="row' + (open ? " open" : "") + (m.state === "down" ? " row-down" : "") + '" data-name="' + esc(m.name.toLowerCase()) + '" data-kind="' + m.kind + '">' +
      '<td class="c-state">' + pill(m.state) + "</td>" +
      '<td class="c-name"><button type="button" class="name-btn" data-action="toggle-row" aria-expanded="' + open + '" aria-controls="' + id + '">' + kindIco(m.kind) +
      '<span><span class="name-main">' + esc(m.name) + (m.isNew ? ' <span class="kind-tag">New</span>' : "") + '</span><span class="name-sub">' + esc(m.kind === "heartbeat" ? m.target : m.target) + "</span></span></button></td>" +
      '<td class="c-kind"><span class="kind-tag">' + KIND[m.kind] + "</span></td>" +
      '<td class="c-bars">' + bars(m) + "</td>" +
      '<td class="c-up num"><strong>' + pct(m.up30) + "</strong></td>" +
      '<td class="c-resp num" data-label="' + (m.kind === "heartbeat" ? "" : "Response") + '">' + respText(m) + "</td>" +
      '<td class="c-chev">' + ico("chevron", "chev") + "</td></tr>" +
      '<tr class="detail" id="' + id + '"' + (open ? "" : " hidden") + '><td colspan="7">' + inlineDetail(m) + "</td></tr>";
  }
  function viewDashboard(filter) {
    var list = all();
    var shown = filter === "heartbeats" ? list.filter(function (m) { return m.kind === "heartbeat"; }) : list;
    var hbCount = list.filter(function (m) { return m.kind === "heartbeat"; }).length;
    var down = defaultDetail();
    var openSlug = app.created ? PENDING.slug : (filter === "heartbeats" ? "nightly-backup" : down.slug);
    // Down first, then paused last; the rest keep their order.
    var rank = { down: 0, degraded: 1, stale: 1, pending: 2, up: 3, maintenance: 3, paused: 4, unknown: 5 };
    shown = shown.map(function (m, i) { return [m, i]; }).sort(function (a, b) { return (rank[a[0].state] - rank[b[0].state]) || (a[1] - b[1]); }).map(function (x) { return x[0]; });
    return '<div class="page-head"><div><h1>' + (filter === "heartbeats" ? "Heartbeats" : "Monitors") + "</h1><p>" +
      (filter === "heartbeats" ? "Jobs that check in with us. We alert you when one goes quiet." : "Everything we watch for " + esc(SITE) + ", checked around the clock.") + "</p></div>" +
      '<div class="actions"><a class="btn btn-secondary btn-big" href="#create-heartbeat">' + ico("heartbeat") + "New heartbeat</a>" +
      '<a class="btn btn-primary btn-big" href="#create-monitor" id="new-monitor">' + ico("plus") + "New monitor</a></div></div>" +
      (filter === "heartbeats" ? "" : checklist()) +
      stats(shown) +
      '<section aria-labelledby="list-h"><h2 id="list-h" class="sr-only">' + (filter === "heartbeats" ? "All heartbeats" : "All monitors and heartbeats") + "</h2>" +
      '<div class="toolbar"><div class="search">' + ico("search") + '<label for="q" class="sr-only">Search by name or address</label><input id="q" type="search" placeholder="Search by name or address" autocomplete="off"></div>' +
      '<nav class="seg" aria-label="Show"><a href="#monitors"' + (filter !== "heartbeats" ? ' aria-current="page"' : "") + '>All <span class="count">' + list.length + '</span></a><a href="#heartbeats"' + (filter === "heartbeats" ? ' aria-current="page"' : "") + '>Heartbeats <span class="count">' + hbCount + "</span></a></nav></div>" +
      '<table class="mtable"><caption class="sr-only">' + shown.length + " items. Select a name to show its details.</caption><thead><tr>" +
      '<th scope="col" class="c-state">Status</th><th scope="col">Name</th><th scope="col" class="c-kind">Type</th><th scope="col" class="c-bars">Last 30 days</th><th scope="col" class="num c-up">Uptime</th><th scope="col" class="num c-resp">Response</th><th scope="col" class="c-chev"><span class="sr-only">Expand</span></th></tr></thead><tbody>' +
      shown.map(function (m) { return row(m, m.slug === openSlug); }).join("") +
      '<tr class="no-match" hidden><td colspan="7">Nothing matches that search.</td></tr></tbody></table></section>';
  }
  function viewEmpty() {
    return '<div class="page-head"><div><h1>Monitors</h1></div></div>' +
      '<section class="card empty" aria-labelledby="empty-h">' +
      '<svg class="art" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="56" fill="currentColor" opacity=".1"/><rect x="26" y="34" width="68" height="48" rx="8" fill="none" stroke="currentColor" stroke-width="4"/><path d="M36 60h10l6-12 10 22 6-10h16" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M48 92h24" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>' +
      '<h2 id="empty-h">Nothing is being watched yet</h2><p>Add a website or server and we check it every minute and tell you the moment it goes down.</p>' +
      '<a class="btn btn-primary btn-big" href="#create-monitor" id="new-monitor">' + ico("plus") + "New monitor</a></section>";
  }

  /* ---------------- first run ---------------- */
  function viewFirstRun() {
    return '<div class="first"><div class="card"><h1>What should we watch?</h1><p class="lead">Two things and you are done. It takes about a minute.</p>' +
      '<form id="first-form" novalidate>' +
      '<div class="first-step"><h2><span class="step-num" aria-hidden="true">1</span>Your website or server</h2>' +
      '<div class="field"><label for="fr-url">Address to check</label><input id="fr-url" class="input-xl" type="url" inputmode="url" autocomplete="url" placeholder="https://example.com" value="https://example.com" aria-describedby="fr-url-hint"><span class="hint" id="fr-url-hint">We check it every minute from Cloudflare\'s network.</span></div></div>' +
      '<div class="first-step"><h2><span class="step-num" aria-hidden="true">2</span>Where should we alert you?</h2>' +
      '<fieldset><legend class="sr-only">Alert channel</legend><div class="tiles">' +
      CH_TYPES.filter(function (t) { return t.type !== "ntfy"; }).map(function (t, i) {
        return '<label class="tile"><input type="radio" name="fr-ch" value="' + t.type + '"' + (i === 0 ? " checked" : "") + '><span>' + ico(t.type) + t.label + "</span></label>";
      }).join("") + "</div></fieldset>" +
      '<div class="field" style="margin-top:18px" id="fr-ch-field">' + channelField(CH_TYPES[0], "fr-dest", "you@example.com") + "</div>" +
      '<div class="test-result" id="fr-test" aria-live="polite"></div></div>' +
      '<div class="first-actions"><button type="button" class="btn btn-secondary btn-big" data-action="first-test">' + ico("send") + 'Send a test alert</button><button type="submit" class="btn btn-primary btn-big">Start monitoring</button></div>' +
      '</form></div><p class="first-foot">Moving from another tool? <a href="#settings">Import your setup</a> in Settings.</p></div>';
  }
  function channelField(t, id, value) {
    return '<label for="' + id + '">' + t.field + '</label><input id="' + id + '" type="' + t.input + '" placeholder="' + esc(t.ph) + '" value="' + esc(value || "") + '" aria-describedby="' + id + '-hint" autocomplete="off"><span class="hint" id="' + id + '-hint">' + esc(t.hint) + "</span>";
  }

  /* ---------------- drawers: monitor form ---------------- */
  function monitorForm(m) {
    var url = m ? (m.kind === "http" ? "https://" + m.target : m.target) : "https://shop.example.org";
    var kind = m ? m.kind : "http";
    var name = m ? m.name : "shop.example.org";
    var iv = m ? m.intervalS : 60;
    var runs = m ? m.runsOn : "Cloudflare edge";
    var intervals = [[60, "Every minute"], [120, "Every 2 minutes"], [300, "Every 5 minutes"], [600, "Every 10 minutes"], [1800, "Every 30 minutes"], [3600, "Every hour"]];
    return '<form id="mon-form" novalidate><div class="field"><label for="f-url">URL or host to check</label>' +
      '<input id="f-url" class="input-xl" type="text" inputmode="url" autocomplete="off" spellcheck="false" value="' + esc(url) + '" placeholder="https://example.com" aria-describedby="f-url-hint">' +
      '<span class="hint" id="f-url-hint">A web address, a host with a port (db.example.com:5432) or just a host name.</span></div>' +
      '<fieldset class="field"><legend>How we check it</legend><div class="chips" id="f-kind">' +
      ["http", "tcp", "ping", "tls"].map(function (k) {
        return '<label class="chip-radio"><input type="radio" name="f-kind" value="' + k + '"' + (k === kind ? " checked" : "") + "><span>" + KIND[k] + "</span></label>";
      }).join("") + '</div><span class="hint" id="f-kind-hint">' + kindHint(kind) + "</span></fieldset>" +
      '<div class="field"><label for="f-name">Name</label><input id="f-name" type="text" value="' + esc(name) + '" aria-describedby="f-name-hint"' + (m ? ' data-touched="1"' : "") + '><span class="hint" id="f-name-hint">Filled in from the address. Change it to anything you like.</span></div>' +
      '<div class="row2" style="margin-top:20px"><div class="field"><label for="f-int">Check</label><select id="f-int">' +
      intervals.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === iv ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></div>" +
      '<div class="field"><label for="f-alerts">Alert</label><select id="f-alerts"><option>All channels (' + CHANNELS.length + ")</option>" +
      CHANNELS.map(function (c) { return "<option>" + esc(c.name) + " only</option>"; }).join("") + "<option>Nobody (just record it)</option></select></div></div>" +
      '<details class="more" id="f-more"><summary><span>More options <span class="hint">method, expected status, keyword, timeout, retries, where it runs</span></span>' + ico("chevron", "chev") + '</summary><div class="more-body">' +
      '<div class="http-only"><div class="row2"><div class="field"><label for="f-method">Method</label><select id="f-method"><option>GET</option><option>HEAD</option></select></div>' +
      '<div class="field"><label for="f-status">Expected status</label><input id="f-status" type="text" value="200 to 399" aria-describedby="f-status-hint"><span class="hint" id="f-status-hint">Anything else counts as down.</span></div></div>' +
      '<div class="field" style="margin-top:20px"><label for="f-kw">Page must contain <span class="hint">(optional)</span></label><input id="f-kw" type="text" placeholder="For example: Welcome back" aria-describedby="f-kw-hint"><span class="hint" id="f-kw-hint">Up only when this exact text is on the page.</span></div></div>' +
      '<div class="row2" style="margin-top:20px"><div class="field"><label for="f-timeout">Give up after</label><select id="f-timeout"><option>5 seconds</option><option selected>10 seconds</option><option>20 seconds</option><option>30 seconds</option></select></div>' +
      '<div class="field"><label for="f-retries">Before alerting</label><select id="f-retries"><option>Alert on the first failure</option><option selected>Retry once</option><option>Retry twice</option><option>Retry 3 times</option></select></div></div>' +
      '<fieldset class="radio-list" style="margin-top:20px"><legend>Where it runs</legend>' +
      '<label><input type="radio" name="f-runs" value="edge"' + (runs === "Cloudflare edge" ? " checked" : "") + "><span>Cloudflare edge<small>From Cloudflare's network. Best for anything public.</small></span></label>" +
      AGENTS.map(function (a) { return '<label><input type="radio" name="f-runs" value="' + esc(a) + '"' + (runs === a ? " checked" : "") + "><span>" + esc(a) + " agent<small>Runs inside your network, for private hosts.</small></span></label>"; }).join("") +
      "</fieldset>" +
      '<div class="field" style="margin-top:20px"><label for="f-quorum">Call it down when</label><select id="f-quorum" aria-describedby="f-quorum-hint"><option>Any place that checks it fails</option><option>Most places agree it failed</option><option>Every place agrees it failed</option></select><span class="hint" id="f-quorum-hint">Only matters when more than one place checks it.</span></div>' +
      "</div></details>" +
      (m ? "" : '<p class="callout info" style="margin-top:24px">' + ico("heartbeat") + '<span>Watching a cron job or a backup instead? <a href="#create-heartbeat">Set up a heartbeat</a>: your job pings us and we alert you when it stops.</span></p>') +
      "</form>";
  }
  function kindHint(k) {
    return {
      http: "HTTP: we load the page and expect a good status code.",
      tcp: "TCP: we open a connection to the port.",
      ping: "Ping: we check the host answers.",
      tls: "TLS: we watch the certificate and warn before it expires."
    }[k];
  }
  function inferKind(v) {
    v = v.trim();
    if (/^https?:\/\//i.test(v)) return "http";
    var port = v.match(/:(\d+)$/);
    if (port) return port[1] === "443" ? "tls" : "tcp";
    if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) return "ping";
    return "http";
  }
  function hostOf(v) { return v.trim().replace(/^[a-z]+:\/\//i, "").replace(/[/?#].*$/, "").replace(/:\d+$/, ""); }

  /* ---------------- drawers: detail ---------------- */
  function chart(m) {
    var pts = m.recent.slice().reverse();
    if (!pts.length) return "";
    var vals = pts.map(function (p) { return p.latencyMs; }).filter(function (n) { return n != null; });
    var W = 700, H = 200, pl = 56, pr = 10, pt = 12, pb = 28;
    var max = Math.max(100, Math.ceil(Math.max.apply(null, vals) / 100) * 100);
    function x(i) { return pl + (W - pl - pr) * i / Math.max(1, pts.length - 1); }
    function y(v) { return pt + (H - pt - pb) * (1 - v / max); }
    var grid = [0, max / 2, max].map(function (v) {
      return '<line class="grid" x1="' + pl + '" x2="' + (W - pr) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text class="axis" x="' + (pl - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + " ms</text>";
    }).join("");
    var segs = [], cur = [], outs = "";
    pts.forEach(function (p, i) {
      if (p.latencyMs == null) {
        if (cur.length) { segs.push(cur); cur = []; }
        var w = (W - pl - pr) / Math.max(1, pts.length - 1);
        outs += '<rect class="outage" x="' + (x(i) - w / 2).toFixed(1) + '" y="' + pt + '" width="' + w.toFixed(1) + '" height="' + (H - pt - pb) + '"/>' +
          '<line class="outage-mark" x1="' + x(i).toFixed(1) + '" x2="' + x(i).toFixed(1) + '" y1="' + (H - pb - 6) + '" y2="' + (H - pb) + '"/>';
      } else cur.push([x(i), y(p.latencyMs)]);
    });
    if (cur.length) segs.push(cur);
    var lines = segs.map(function (s) {
      var d = s.map(function (q, i) { return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); }).join(" ");
      var a = s.length > 1 ? '<path class="area" d="' + d + " L" + s[s.length - 1][0].toFixed(1) + " " + (H - pb) + " L" + s[0][0].toFixed(1) + " " + (H - pb) + ' Z"/>' : "";
      return a + '<path class="line" d="' + d + '"/>';
    }).join("");
    var failed = pts.length - vals.length;
    var avg = vals.length ? Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length) : 0;
    var label = "Response time for the last " + pts.length + " checks: average " + avg + " ms, fastest " + Math.min.apply(null, vals) + " ms, slowest " + Math.max.apply(null, vals) + " ms" + (failed ? ", " + failed + " failed checks" : "") + ".";
    return '<svg class="chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + label + '">' + grid + outs + lines +
      '<text class="axis" x="' + pl + '" y="' + (H - 8) + '">' + hhmm(pts[0].ts) + '</text><text class="axis" x="' + (W - pr) + '" y="' + (H - 8) + '" text-anchor="end">' + hhmm(pts[pts.length - 1].ts) + " UTC</text></svg>" +
      '<p class="chart-legend"><span><i class="swatch"></i>Response time</span>' + (failed ? '<span><i class="swatch out"></i>Failed checks (' + failed + ")</span>" : "") + "<span>Average " + avg + " ms</span></p>";
  }
  function detailBody(m) {
    var open = m.incidents.filter(function (i) { return !i.endedAt; })[0];
    var head = '<div class="det-head">' + kindIco(m.kind) + '<div style="flex:1;min-width:0"><p class="det-sub">' + KIND[m.kind] + " · " + esc(m.target) + "</p>" +
      '<p style="margin-top:6px">' + pill(m.state, true) + (open ? ' <span class="muted">for ' + dur(open.durationS) + ", since " + hhmm(open.startedAt) + " UTC</span>" : (m.state === "up" && m.lastCheckS != null ? ' <span class="muted">last checked ' + ago(m.lastCheckS) + "</span>" : "")) + "</p></div></div>" +
      '<div class="det-actions"><button type="button" class="btn btn-secondary" data-action="toast" data-msg="Test alert sent to ' + CHANNELS.length + ' channels">' + ico("send") + "Send test alert</button>" +
      '<a class="btn btn-secondary" href="#edit-monitor/' + m.slug + '">' + ico("edit") + "Edit</a>" +
      '<button type="button" class="btn btn-secondary" data-action="toast" data-msg="' + (m.state === "paused" ? "Resumed " : "Paused ") + esc(m.name) + '">' + ico(m.state === "paused" ? "play" : "pause") + (m.state === "paused" ? "Resume" : "Pause") + "</button>" +
      '<button type="button" class="btn btn-danger" data-action="ask-delete" aria-controls="del-confirm" aria-expanded="false">' + ico("trash") + "Delete</button></div>" +
      '<div class="callout warn" id="del-confirm" hidden style="margin-top:12px">' + ico("degraded") + '<div><p><strong>Delete ' + esc(m.name) + "?</strong> Its history goes too. This cannot be undone.</p>" +
      '<p class="actions" style="margin-top:10px"><button type="button" class="btn btn-danger-solid btn-sm" data-action="toast" data-msg="Deleted ' + esc(m.name) + ' (not really, this is a mock-up)">Delete for good</button><button type="button" class="btn btn-secondary btn-sm" data-action="ask-delete">Keep it</button></p></div></div>';
    var tiles = '<section class="drawer-section" aria-labelledby="up-h"><h3 id="up-h">Uptime</h3><dl class="tiles4">' +
      [["24 hours", m.up24], ["7 days", m.up7], ["30 days", m.up30]].map(function (t) { return "<div><dt>" + t[0] + "</dt><dd>" + pct(t[1]) + "</dd></div>"; }).join("") +
      "<div><dt>" + (m.kind === "heartbeat" ? "Last ping" : "Avg. response") + "</dt><dd>" + (m.kind === "heartbeat" ? ago(m.lastPingS) : ms(m.avgLatency)) + "</dd></div></dl></section>";
    var resp = m.kind === "heartbeat" ? "" : '<section class="drawer-section" aria-labelledby="rt-h"><h3 id="rt-h">Response time</h3>' + chart(m) + "</section>";
    var inc = '<section class="drawer-section" aria-labelledby="inc-h"><h3 id="inc-h">Incidents</h3>' + (m.incidents.length ? '<ul class="list">' + m.incidents.map(function (i) {
      return '<li class="incident">' + pill(i.endedAt ? "up" : "down") + "<div><strong>" + esc(i.title) + '</strong><span class="muted">' + (i.endedAt ? "Resolved after " + dur(i.durationS) + ", " + i.startedAt.slice(0, 10) + " at " + hhmm(i.startedAt) + " UTC" : "Ongoing, started " + hhmm(i.startedAt) + " UTC, " + dur(i.durationS) + " so far") + "</span></div></li>";
    }).join("") + "</ul>" : '<p class="muted">No incidents in the last 90 days.</p>') + "</section>";
    var rows = m.recent.slice(0, 12);
    var checks = '<section class="drawer-section" aria-labelledby="rc-h"><h3 id="rc-h">' + (m.kind === "heartbeat" ? "Recent pings" : "Recent checks") + "</h3>" + (rows.length ?
      '<table class="checks"><thead><tr><th scope="col">Time (UTC)</th><th scope="col">Result</th><th scope="col" class="num">Response</th><th scope="col" class="c-msg">Details</th></tr></thead><tbody>' +
      rows.map(function (r) { return "<tr><td>" + (m.kind === "heartbeat" ? r.ts.slice(5, 10) + " " : "") + hhmmss(r.ts) + "</td><td>" + pill(r.status) + '</td><td class="num">' + (m.kind === "heartbeat" ? "" : ms(r.latencyMs)) + '</td><td class="c-msg muted">' + esc(r.message || "") + "</td></tr>"; }).join("") +
      "</tbody></table>" : '<p class="muted">Nothing yet.</p>') + "</section>";
    var how = '<section class="drawer-section" aria-labelledby="set-h"><h3 id="set-h">Settings</h3><ul class="inline-meta">' +
      (m.kind === "heartbeat" ? "<li>" + ico("pending", "i-sm") + esc(m.target) + "</li>" : "<li>" + ico("pending", "i-sm") + "Checked " + every(m.intervalS) + "</li><li>" + ico(m.runsOn === "Cloudflare edge" ? "cloud" : "server", "i-sm") + "Runs from " + esc(m.runsOn) + (m.runsOn === "Cloudflare edge" ? "" : " agent") + "</li>") +
      "<li>" + ico("ntfy", "i-sm") + "Alerts go to all channels (" + CHANNELS.length + ")</li><li>" + ico("eye", "i-sm") + (m.section ? "On the status page as \"" + esc(m.publicName) + "\" in " + esc(m.section) : "Not on the status page") + "</li></ul></section>";
    return head + tiles + resp + inc + checks + how;
  }
  function pendingBody() {
    var m = PENDING;
    return '<div class="det-head">' + kindIco("http") + '<div style="flex:1;min-width:0"><p class="det-sub">HTTP · ' + esc(m.target) + '</p><p style="margin-top:6px">' + pill("pending", true) + "</p></div></div>" +
      '<div class="pending-box" style="margin-top:24px" role="status"><span class="pulse">' + ico("pending") + '</span><div><h3>Pending, waiting for the first check</h3><p>The first check runs within a minute. You can close this; it keeps going and the dashboard updates by itself.</p></div></div>' +
      '<section class="drawer-section" aria-labelledby="up-h"><h3 id="up-h">Uptime</h3><dl class="tiles4"><div><dt>24 hours</dt><dd class="none">No data yet</dd></div><div><dt>7 days</dt><dd class="none">No data yet</dd></div><div><dt>30 days</dt><dd class="none">No data yet</dd></div><div><dt>Avg. response</dt><dd class="none">No data yet</dd></div></dl></section>' +
      '<section class="drawer-section" aria-labelledby="set-h"><h3 id="set-h">What we set up</h3><ul class="inline-meta">' +
      "<li>" + ico("pending", "i-sm") + "Checked every minute from Cloudflare edge</li><li>" + ico("check", "i-sm") + "Up when it answers with a status from 200 to 399 within 10 seconds</li><li>" + ico("ntfy", "i-sm") + "Alerts go to all channels (" + CHANNELS.length + "), after one retry</li></ul></section>" +
      '<section class="drawer-section" aria-labelledby="nx-h"><h3 id="nx-h">While you wait</h3><div class="actions">' +
      '<button type="button" class="btn btn-secondary" data-action="toast" data-msg="Test alert sent to ' + CHANNELS.length + ' channels">' + ico("send") + 'Send a test alert</button><a class="btn btn-secondary" href="#status-page">' + ico("eye") + "Add it to the status page</a></div></section>";
  }

  /* ---------------- drawers: heartbeat ---------------- */
  var HB_URL = "https://status.example.com/beat/7Kq2xN4pLm9RtY3wVd8s";
  function heartbeatBody() {
    return '<form id="hb-form" novalidate><div class="field"><label for="hb-name">Name</label><input id="hb-name" type="text" value="Database backup" placeholder="For example: Nightly backup"></div>' +
      '<fieldset class="field"><legend>When should it check in?</legend><div class="sentence">' +
      '<span aria-hidden="true">Expect a heartbeat every</span><label class="sr-only" for="hb-every">Expect a heartbeat every</label><input id="hb-every" type="number" min="1" value="60">' +
      '<label class="sr-only" for="hb-unit">Unit</label><select id="hb-unit"><option>minutes</option><option>hours</option><option>days</option></select>' +
      '<span aria-hidden="true">, grace</span><label class="sr-only" for="hb-grace">Grace period</label><input id="hb-grace" type="number" min="0" value="1">' +
      '<label class="sr-only" for="hb-gunit">Grace unit</label><select id="hb-gunit"><option>minute</option><option>hour</option></select></div>' +
      '<span class="hint" id="hb-summary">If nothing arrives within 61 minutes of the last ping, we alert you.</span></fieldset>' +
      '<div class="field"><label for="hb-alerts">Alert</label><select id="hb-alerts"><option>All channels (' + CHANNELS.length + ")</option>" + CHANNELS.map(function (c) { return "<option>" + esc(c.name) + " only</option>"; }).join("") + "</select></div></form>" +
      '<section class="drawer-section" aria-labelledby="hb-url-h"><h3 id="hb-url-h">Your heartbeat address</h3><p class="muted" style="margin-bottom:10px">Call this address at the end of your job. Any request works.</p>' +
      '<div class="code"><code id="hb-url">' + HB_URL + '</code><button type="button" class="btn btn-secondary btn-sm" data-action="copy" data-target="hb-url">' + ico("copy", "i-sm") + "Copy</button></div>" +
      '<p class="muted" style="margin:16px 0 10px">Or add this line to the end of your script:</p>' +
      '<div class="code"><code id="hb-curl">curl -fsS "' + HB_URL + '?status=up&amp;msg=OK"</code><button type="button" class="btn btn-secondary btn-sm" data-action="copy" data-target="hb-curl">' + ico("copy", "i-sm") + "Copy</button></div>" +
      '<p class="callout warn" style="margin-top:16px">' + ico("lock") + "<span><strong>Shown once.</strong> Copy it now. The address works like a password; if you lose it, make a new one from the heartbeat's settings and the old one stops working.</span></p></section>" +
      '<section class="drawer-section" aria-labelledby="hb-st-h"><h3 id="hb-st-h" class="sr-only">Status</h3><div class="pending-box" role="status"><span class="pulse">' + ico("heartbeat") + '</span><div><h3>Pending, waiting for the first heartbeat</h3><p>Run your job or the curl line above. This turns green as soon as the first ping arrives.</p></div></div></section>';
  }

  /* ---------------- drawers: channel ---------------- */
  function channelBody() {
    return '<form id="ch-form" novalidate><fieldset><legend>Send alerts by</legend><div class="tiles">' +
      CH_TYPES.map(function (t, i) { return '<label class="tile"><input type="radio" name="ch-type" value="' + t.type + '"' + (i === 1 ? " checked" : "") + "><span>" + ico(t.type) + t.label + "</span></label>"; }).join("") +
      '</div></fieldset><div class="field" id="ch-field" style="margin-top:20px">' + channelField(CH_TYPES[1], "ch-dest", "") + "</div>" +
      '<div class="field"><label for="ch-name">Name</label><input id="ch-name" type="text" value="Team Discord"></div>' +
      '<fieldset style="margin-top:20px"><legend>Tell me when something</legend>' +
      Object.keys(EVENTS).map(function (k) { return '<label class="check"><input type="checkbox" checked>' + EVENTS[k] + "</label>"; }).join("") + "</fieldset>" +
      '<div class="field"><label for="ch-scope">For</label><select id="ch-scope"><option>All monitors and heartbeats</option>' + V.sections.map(function (s) { return "<option>" + esc(s.title) + " section only</option>"; }).join("") + "</select></div></form>";
  }

  /* ---------------- status page ---------------- */
  var THEMES = [
    ["sys.status", "#0b1220", "#22c55e", "#1e293b"], ["Control Room", "#05070a", "#f59e0b", "#1f2937"], ["Session", "#16161d", "#a78bfa", "#27272f"],
    ["Classic", "#ffffff", "#16a34a", "#e5e7eb"], ["Editorial", "#fbf8f2", "#1f2937", "#e7e0d2"], ["Dashboard", "#f1f5f9", "#6366f1", "#ffffff"],
    ["Wallboard", "#000000", "#4ade80", "#111827"], ["Friendly", "#fff7ed", "#fb923c", "#fde7d0"], ["Minimal", "#ffffff", "#111111", "#f3f4f6"]
  ];
  function themePreview(t) {
    return '<svg viewBox="0 0 90 56" aria-hidden="true"><rect width="90" height="56" fill="' + t[1] + '"/><rect x="8" y="8" width="44" height="6" rx="3" fill="' + t[2] + '"/>' +
      '<rect x="8" y="20" width="74" height="10" rx="3" fill="' + t[3] + '"/><rect x="8" y="34" width="74" height="10" rx="3" fill="' + t[3] + '"/>' +
      '<circle cx="76" cy="25" r="2.5" fill="' + t[2] + '"/><circle cx="76" cy="39" r="2.5" fill="' + t[2] + '"/></svg>';
  }
  var spSections = null;
  function initSp() {
    if (spSections) return;
    spSections = V.sections.map(function (sec) {
      return { title: sec.title, items: sec.services.map(function (s) { return slug(s.name); }) };
    });
  }
  function spItem(sIdx, slugId) {
    var m = find(slugId);
    return '<li class="sp-item" draggable="true" data-slug="' + m.slug + '" data-sec="' + sIdx + '">' +
      '<button type="button" class="handle" data-action="noop" aria-label="Move ' + esc(m.name) + ': drag, or use the up and down arrow keys">' + ico("grip") + "</button>" +
      '<div class="sp-name">' + kindIco(m.kind) + "<div><strong>" + esc(m.name) + "</strong><small>" + KIND[m.kind] + "</small></div></div>" +
      '<div class="sp-public"><label class="sr-only" for="pn-' + m.slug + '">Public name for ' + esc(m.name) + '</label><input id="pn-' + m.slug + '" type="text" value="' + esc(m.publicName) + '" placeholder="Public name"></div>' +
      '<button type="button" class="icon-btn rm" data-action="sp-remove"><span class="sr-only">Remove ' + esc(m.name) + " from this section</span>" + ico("x") + "</button></li>";
  }
  function unplaced() {
    var placed = {};
    spSections.forEach(function (s) { s.items.forEach(function (i) { placed[i] = 1; }); });
    return monitors.filter(function (m) { return !placed[m.slug]; });
  }
  function pickerOptions(sIdx, q) {
    q = (q || "").toLowerCase();
    var list = unplaced().filter(function (m) { return !q || m.name.toLowerCase().indexOf(q) >= 0; });
    if (!list.length) return '<li class="empty-opt" role="option" aria-disabled="true">' + (q ? "Nothing called that. Everything else is already on the page." : "Everything is already on the page.") + "</li>";
    return list.map(function (m, i) {
      return '<li role="option" id="opt-' + sIdx + "-" + m.slug + '" data-slug="' + m.slug + '" aria-selected="' + (i === 0) + '">' + kindIco(m.kind) + "<span>" + esc(m.name) + "</span><small>" + KIND[m.kind] + "</small></li>";
    }).join("");
  }
  function spSection(sec, i, openPicker) {
    return '<section class="card sp-section" data-sec="' + i + '" aria-labelledby="sec-h-' + i + '"><h3 class="sr-only" id="sec-h-' + i + '">Section ' + (i + 1) + ": " + esc(sec.title) + "</h3>" +
      '<div class="sp-sec-head"><div class="field"><label for="sec-name-' + i + '">Section name</label><input id="sec-name-' + i + '" type="text" value="' + esc(sec.title) + '"></div>' +
      '<button type="button" class="icon-btn" data-action="sec-up"' + (i === 0 ? " disabled" : "") + '><span class="sr-only">Move section ' + esc(sec.title) + " up</span>" + ico("arrowUp") + "</button>" +
      '<button type="button" class="icon-btn" data-action="sec-down"' + (i === spSections.length - 1 ? " disabled" : "") + '><span class="sr-only">Move section ' + esc(sec.title) + " down</span>" + ico("arrowDown") + "</button>" +
      '<button type="button" class="icon-btn" data-action="sec-remove"><span class="sr-only">Remove section ' + esc(sec.title) + "</span>" + ico("trash") + "</button></div>" +
      '<ol class="sp-items" aria-label="Services in ' + esc(sec.title) + '">' + sec.items.map(function (s) { return spItem(i, s); }).join("") + "</ol>" +
      '<div class="picker"><div class="search">' + ico("search") + '<label class="sr-only" for="pick-' + i + '">Search monitors to add to ' + esc(sec.title) + "</label>" +
      '<input id="pick-' + i + '" type="text" role="combobox" autocomplete="off" aria-autocomplete="list" aria-controls="pick-list-' + i + '" aria-expanded="' + !!openPicker + '" placeholder="Search monitors and heartbeats to add" data-sec="' + i + '"></div>' +
      '<ul class="picker-list" role="listbox" id="pick-list-' + i + '" aria-label="Monitors and heartbeats not on the page"' + (openPicker ? "" : " hidden") + ">" + pickerOptions(i, "") + "</ul></div></section>";
  }
  function renderSections(openLast) {
    return spSections.map(function (s, i) { return spSection(s, i, openLast && i === spSections.length - 1); }).join("");
  }
  function viewStatusPage() {
    initSp();
    return '<div class="page-head"><div><h1>Status page</h1><p>What your visitors see at <strong>status.example.com</strong>. Drag to reorder; the public name is what they read.</p></div>' +
      '<div class="actions"><a class="btn btn-secondary" href="https://status.example.com" target="_blank" rel="noopener">' + ico("external") + 'View page<span class="sr-only"> (opens in a new tab)</span></a><button type="button" class="btn btn-primary" data-action="toast" data-msg="Status page saved">Save changes</button></div></div>' +
      '<div class="sp-layout"><section aria-labelledby="sp-struct-h"><h2 id="sp-struct-h" class="sr-only">Sections</h2><div id="sp-sections">' + renderSections(true) + "</div>" +
      '<button type="button" class="btn btn-secondary btn-big btn-block" style="margin-top:16px" data-action="sec-add">' + ico("plus") + "Add section</button></section>" +
      '<aside aria-label="Page settings"><section class="card side-card" aria-labelledby="vis-h"><h2 id="vis-h">Who can see it</h2><fieldset class="radio-list"><legend class="sr-only">Visibility</legend>' +
      '<label><input type="radio" name="vis" checked><span>Public<small>Anyone with the address.</small></span></label>' +
      '<label><input type="radio" name="vis"><span>Hidden from search engines<small>Public, but not listed by Google and friends.</small></span></label>' +
      '<label><input type="radio" name="vis"><span>Private<small>Only people signed in to this admin.</small></span></label></fieldset></section>' +
      '<section class="card side-card" aria-labelledby="theme-h"><h2 id="theme-h">Look</h2><fieldset><legend class="sr-only">Theme</legend><div class="themes">' +
      THEMES.map(function (t, i) { return '<label class="theme"><input type="radio" name="theme" value="' + esc(t[0]) + '"' + (i === 3 ? " checked" : "") + "><span>" + themePreview(t) + esc(t[0]) + "</span></label>"; }).join("") +
      '</div></fieldset><p class="hint" style="margin-top:10px">Preview any theme with View page before you save.</p></section></aside></div>';
  }

  /* ---------------- alerts ---------------- */
  function viewAlerts() {
    return '<div class="page-head"><div><h1>Alerts</h1><p>Where we tell you when something goes down or comes back.</p></div>' +
      '<div class="actions"><a class="btn btn-primary btn-big" href="#add-channel" id="add-channel-btn">' + ico("plus") + "Add channel</a></div></div>" +
      '<div class="channels">' + CHANNELS.map(function (c) {
        var t = CH_TYPES.filter(function (x) { return x.type === c.type; })[0];
        return '<article class="card channel" aria-labelledby="ch-' + slug(c.name) + '"><span class="ch-ico">' + ico(c.type) + '<span class="sr-only">' + t.label + "</span></span>" +
          '<div><h2 id="ch-' + slug(c.name) + '">' + esc(c.name) + '</h2><p class="dest">' + t.label + " · " + esc(c.dest) + " · " + esc(c.scope) + "</p>" +
          '<ul class="events" aria-label="Sends when something">' + c.events.map(function (e) { return '<li class="ev">' + ico("check") + EVENTS[e] + "</li>"; }).join("") + "</ul>" +
          '<p class="ch-last">Last alert ' + esc(c.last) + "</p></div>" +
          '<div class="ch-actions"><button type="button" class="btn btn-secondary" data-action="toast" data-msg="Test alert sent to ' + esc(c.name) + '">' + ico("send") + 'Send test<span class="sr-only"> to ' + esc(c.name) + "</span></button>" +
          '<button type="button" class="btn btn-ghost" data-action="toast" data-msg="Editing channels opens the same drawer as Add channel">' + ico("edit") + 'Edit<span class="sr-only"> ' + esc(c.name) + "</span></button></div></article>";
      }).join("") + "</div>" +
      '<h2 class="section-title">Recent alerts</h2><ul class="list card">' +
      [["down", "Replica Postgres is down", "Sent to 3 channels", "6 min ago"], ["up", "Web app is back up after 4 minutes", "Sent to 3 channels", "3 days ago"], ["down", "Web app is down", "Sent to 4 channels", "3 days ago"], ["up", "Test alert", "Sent to On-call inbox", "5 days ago"]].map(function (a) {
        return "<li>" + pill(a[0]) + '<div style="flex:1;min-width:0"><strong>' + esc(a[1]) + '</strong><br><span class="muted">' + a[2] + '</span></div><span class="muted">' + a[3] + "</span></li>";
      }).join("") + "</ul>";
  }

  /* ---------------- settings ---------------- */
  function viewSettings() {
    var cfg = {
      site: { name: SITE, statusPage: "status.example.com", theme: "classic" },
      monitors: monitors.filter(function (m) { return m.kind !== "heartbeat"; }).slice(0, 4).map(function (m) {
        return { name: m.name, type: m.kind, target: m.target, every: every(m.intervalS).replace("every ", "") };
      }),
      heartbeats: monitors.filter(function (m) { return m.kind === "heartbeat"; }).map(function (m) { return { name: m.name, grace: m.grace }; }),
      channels: CHANNELS.map(function (c) { return { name: c.name, type: c.type, events: c.events }; })
    };
    var nav = [["set-sources", "key", "Sources and keys"], ["set-users", "users", "Users and invites"], ["set-rev", "history", "Revisions"], ["set-io", "swap", "Import and export"], ["set-adv", "code", "Advanced"]];
    return '<div class="page-head"><div><h1>Settings</h1><p>The power tools. You will rarely need them.</p></div></div>' +
      '<div class="set-layout"><nav class="set-nav" aria-label="Settings sections">' + nav.map(function (n) { return '<button type="button" data-action="scrollto" data-target="' + n[0] + '">' + ico(n[1]) + n[2] + "</button>"; }).join("") + "</nav><div>" +
      '<section class="card set-block" id="set-sources" aria-labelledby="h-sources"><h2 id="h-sources">Sources and keys</h2><p class="muted">Where results come from besides our own checks. Each key lets one sender report in.</p>' +
      '<table class="tbl tbl-stack"><thead><tr><th scope="col">Source</th><th scope="col">Last heard from</th><th scope="col">Key</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      [["Cloudflare edge", "Built in, runs our checks", "ok", "34 s ago", "No key needed"], ["Uptime Kuma collector", "Sends Kuma results every minute", "ok", "34 s ago", "Ends in a91f"], ["App server facts", "Disk, memory and backups", "ok", "13 min ago", "Ends in 4c07"], ["Berlin office agent", "Private checks inside the office", "ok", "20 s ago", "Ends in e2b8"], ["Home lab agent", "Private checks at home", "bad", "2 h ago", "Ends in 91d3"]].map(function (s) {
        return "<tr><td><strong>" + s[0] + "</strong><small>" + s[1] + '</small></td><td><span class="fresh ' + s[2] + '">' + ico(s[2] === "ok" ? "up" : "degraded", "i-sm") + (s[2] === "ok" ? "" : "Quiet, ") + s[3] + '</span></td><td class="mono">' + s[4] + '</td><td class="act">' + (s[4] === "No key needed" ? "" : '<button type="button" class="btn btn-secondary btn-sm" data-action="toast" data-msg="New key made for ' + s[0] + '. The old one works for 24 more hours.">Rotate key<span class="sr-only"> for ' + s[0] + "</span></button>") + "</td></tr>";
      }).join("") + '</tbody></table><p style="margin-top:14px"><button type="button" class="btn btn-secondary" data-action="toast" data-msg="Adding a source opens a short drawer (not in this mock-up)">' + ico("plus") + "Add a source or agent</button></p></section>" +
      '<section class="card set-block" id="set-users" aria-labelledby="h-users"><h2 id="h-users">Users and invites</h2><p class="muted">People who can sign in to this admin.</p>' +
      '<table class="tbl tbl-stack"><thead><tr><th scope="col">Person</th><th scope="col">Role</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>' +
      [["Sam Rivera", "sam@example.com", "Owner (you)"], ["Priya Nair", "priya@example.com", "Admin"], ["Tom Becker", "tom@example.org", "Viewer"], ["jo@example.org", "Invited 2 days ago, not accepted yet", "Viewer"]].map(function (u, i) {
        return "<tr><td><strong>" + u[0] + "</strong><small>" + u[1] + "</small></td><td>" + u[2] + '</td><td class="act">' + (i === 0 ? "" : i === 3 ? '<button type="button" class="btn btn-secondary btn-sm" data-action="toast" data-msg="Invite sent again">Resend</button> <button type="button" class="btn btn-ghost btn-sm" data-action="toast" data-msg="Invite cancelled">Cancel invite</button>' : '<button type="button" class="btn btn-ghost btn-sm" data-action="toast" data-msg="Role editor opens here">Change role<span class="sr-only"> for ' + u[0] + "</span></button>") + "</td></tr>";
      }).join("") + "</tbody></table>" +
      '<form class="invite" onsubmit="return false"><div class="field"><label for="inv-email">Invite by email</label><input id="inv-email" type="email" placeholder="name@example.com"></div><div class="field"><label for="inv-role">Role</label><select id="inv-role"><option>Viewer</option><option>Admin</option></select></div><button type="button" class="btn btn-primary" data-action="toast" data-msg="Invite sent">Send invite</button></form></section>' +
      '<section class="card set-block" id="set-rev" aria-labelledby="h-rev"><h2 id="h-rev">Revisions</h2><p class="muted">Every save is kept. Go back to any of them.</p><ul class="list">' +
      [["Paused Staging site", "Priya Nair", "5 days ago"], ["Added Certificate for example.com", "Sam Rivera", "8 days ago"], ["Moved Runner ping to Workers", "Sam Rivera", "12 days ago"], ["Imported from Uptime Kuma", "Sam Rivera", "30 days ago"]].map(function (r, i) {
        return '<li><div style="flex:1;min-width:0"><strong>' + r[0] + '</strong><br><span class="muted">' + r[1] + ", " + r[2] + (i === 0 ? " · current" : "") + "</span></div>" + (i === 0 ? "" : '<button type="button" class="btn btn-secondary btn-sm" data-action="toast" data-msg="Restored the version from ' + r[2] + '">Restore<span class="sr-only"> ' + r[0] + "</span></button>") + "</li>";
      }).join("") + "</ul></section>" +
      '<section class="card set-block" id="set-io" aria-labelledby="h-io"><h2 id="h-io">Import and export</h2><p class="muted">Move your setup in or out as one file.</p><div class="actions">' +
      '<button type="button" class="btn btn-secondary" data-action="toast" data-msg="Downloaded acme-cloud-uptellis.json">Export everything</button>' +
      '<label class="btn btn-secondary" for="imp-file">Import a file</label><input id="imp-file" type="file" class="sr-only" accept=".json">' +
      '<button type="button" class="btn btn-secondary" data-action="toast" data-msg="Uptime Kuma import opens a short drawer (not in this mock-up)">Import from Uptime Kuma</button></div></section>' +
      '<section class="card set-block" id="set-adv" aria-labelledby="h-adv"><h2 id="h-adv">Advanced</h2><p class="muted">For people who like files. Everything above is also here.</p>' +
      '<details class="more" style="margin-top:0"><summary><span>Edit config as JSON <span class="hint">checked before it is saved</span></span>' + ico("chevron", "chev") + '</summary><div class="more-body">' +
      '<label for="json">Config</label><textarea id="json" class="json" spellcheck="false">' + esc(JSON.stringify(cfg, null, 2)) + '</textarea><p class="actions" style="margin-top:12px"><button type="button" class="btn btn-primary" data-action="toast" data-msg="Config is valid and saved as a new revision">Check and save</button></p></div></details>' +
      '<div class="callout warn" style="margin-top:16px">' + ico("degraded") + '<div><strong>Delete this site</strong><p class="muted">Removes every monitor, heartbeat and its history.</p><p style="margin-top:10px"><button type="button" class="btn btn-danger btn-sm" data-action="toast" data-msg="Deleting needs you to type the site name (not in this mock-up)">Delete ' + esc(SITE) + "</button></p></div></div></section>" +
      "</div></div>";
  }

  /* ---------------- drawer control ---------------- */
  var drawer = $("#drawer");
  function openDrawer(o) {
    $("#drawer-title").textContent = o.title;
    $("#drawer-body").innerHTML = o.body;
    $("#drawer-foot").innerHTML = o.foot || "";
    drawer.classList.toggle("wide", !!o.wide);
    drawer.dataset.back = o.back || "monitors";
    if (!drawer.open) {
      if (!app.opener && document.activeElement && document.activeElement !== document.body) app.opener = document.activeElement;
      try { drawer.showModal(); } catch (e) { drawer.setAttribute("open", ""); }
    }
    $("#drawer-body").scrollTop = 0;
    var f = o.focus && $(o.focus);
    if (f) { f.focus(); if (f.select && o.select) f.select(); }
    else $(".drawer-head .icon-btn").focus();
    if (o.after) o.after();
  }
  function closeDrawer() {
    if (drawer.open) drawer.close();
  }
  drawer.addEventListener("close", function () {
    var back = drawer.dataset.back || "monitors";
    if (location.hash.slice(1).split("/")[0] !== back) location.hash = "#" + back;
    var o = app.opener; app.opener = null;
    setTimeout(function () {
      if (o && document.contains(o)) o.focus();
      else { var n = $("#new-monitor") || $("#main"); if (n) n.focus(); }
    }, 0);
  });
  drawer.addEventListener("click", function (e) { if (e.target === drawer) closeDrawer(); });

  function wireMonitorForm() {
    var url = $("#f-url"), name = $("#f-name");
    function sync() {
      var k = inferKind(url.value);
      var r = $('input[name="f-kind"][value="' + k + '"]'); if (r) r.checked = true;
      $("#f-kind-hint").textContent = kindHint(k) + (url.value ? " We picked it from the address." : "");
      if (!name.dataset.touched) name.value = hostOf(url.value);
      toggleHttp();
    }
    function toggleHttp() {
      var k = ($('input[name="f-kind"]:checked') || {}).value;
      var box = $(".http-only"); if (box) box.hidden = k !== "http";
    }
    url.addEventListener("input", sync);
    name.addEventListener("input", function () { name.dataset.touched = "1"; });
    $$('input[name="f-kind"]').forEach(function (r) { r.addEventListener("change", function () { $("#f-kind-hint").textContent = kindHint(r.value); toggleHttp(); }); });
    toggleHttp();
  }
  function wireHeartbeat() {
    function upd() {
      var n = parseInt($("#hb-every").value, 10) || 0, g = parseInt($("#hb-grace").value, 10) || 0;
      var u = $("#hb-unit").value, gu = $("#hb-gunit").value;
      var mins = n * (u === "hours" ? 60 : u === "days" ? 1440 : 1) + g * (gu === "hour" ? 60 : 1);
      $("#hb-summary").textContent = "If nothing arrives within " + dur(mins * 60) + " of the last ping, we alert you.";
    }
    ["#hb-every", "#hb-unit", "#hb-grace", "#hb-gunit"].forEach(function (s) { $(s).addEventListener("input", upd); $(s).addEventListener("change", upd); });
  }
  function wireChannelTypes(name, fieldId, inputId) {
    $$('input[name="' + name + '"]').forEach(function (r) {
      r.addEventListener("change", function () {
        var t = CH_TYPES.filter(function (x) { return x.type === r.value; })[0];
        $("#" + fieldId).innerHTML = channelField(t, inputId, "");
      });
    });
  }

  /* ---------------- routing ---------------- */
  var TITLES = { "first-run": "Welcome", monitors: "Monitors", "monitors-empty": "Monitors", heartbeats: "Heartbeats", "status-page": "Status page", alerts: "Alerts", settings: "Settings" };
  function setTab(t) {
    $$(".tabs a").forEach(function (a) { if (a.dataset.tab === t) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  }
  function renderBase(base) {
    var key = base + (app.created ? "+new" : "");
    if (app.base === key) return false;
    app.base = key;
    var main = $("#main");
    document.body.classList.toggle("bare", base === "first-run");
    if (base === "first-run") main.innerHTML = viewFirstRun();
    else if (base === "monitors-empty") main.innerHTML = viewEmpty();
    else if (base === "heartbeats") main.innerHTML = viewDashboard("heartbeats");
    else if (base === "status-page") main.innerHTML = viewStatusPage();
    else if (base === "alerts") main.innerHTML = viewAlerts();
    else if (base === "settings") main.innerHTML = viewSettings();
    else main.innerHTML = viewDashboard("all");
    setTab(base === "heartbeats" || base === "monitors-empty" || base === "first-run" ? "monitors" : base);
    document.title = (TITLES[base] || "Monitors") + " · Uptellis";
    wireBase(base);
    return true;
  }
  function route() {
    var h = location.hash.replace(/^#/, "");
    if (h === "main") return;
    var parts = h.split("/"), r = parts[0] || "monitors", arg = parts[1];
    var drawerFor = {
      "create-monitor": "monitors", "edit-monitor": "monitors", monitor: "monitors", "monitor-pending": "monitors",
      "create-heartbeat": "heartbeats", "add-channel": "alerts"
    };
    if (r === "monitor-pending") app.created = true;
    var base = drawerFor[r] || (TITLES[r] ? r : "monitors");
    var changed = renderBase(base);
    if (!drawerFor[r]) {
      if (drawer.open) { drawer.dataset.back = r; closeDrawer(); }
      else if (changed && !location.hash.match(/^#?$/)) { /* keep focus where the browser left it */ }
      return;
    }
    if (r === "create-monitor") {
      openDrawer({ title: "New monitor", body: monitorForm(null), focus: "#f-url", select: false,
        foot: '<button type="button" class="btn btn-secondary" data-action="close-drawer">Cancel</button><a class="btn btn-primary" href="#monitor-pending">Create monitor</a>',
        after: wireMonitorForm });
    } else if (r === "edit-monitor") {
      var em = find(arg) || defaultDetail();
      openDrawer({ title: "Edit " + em.name, body: monitorForm(em), focus: "#f-url",
        foot: '<button type="button" class="btn btn-secondary" data-action="close-drawer">Cancel</button><button type="button" class="btn btn-primary" data-action="save-close" data-msg="Saved ' + esc(em.name) + '">Save changes</button>',
        after: wireMonitorForm });
    } else if (r === "monitor") {
      var m = find(arg) || defaultDetail();
      openDrawer({ title: m.name, body: detailBody(m), wide: true });
    } else if (r === "monitor-pending") {
      openDrawer({ title: PENDING.name, body: pendingBody(), wide: true,
        foot: '<a class="btn btn-primary" href="#monitors">Back to the dashboard</a>' });
    } else if (r === "create-heartbeat") {
      openDrawer({ title: "New heartbeat", body: heartbeatBody(), focus: "#hb-name", back: "heartbeats",
        foot: '<span class="hint spacer">Saved already. You can change it any time.</span><a class="btn btn-primary" href="#heartbeats">Done</a>',
        after: wireHeartbeat });
    } else if (r === "add-channel") {
      openDrawer({ title: "Add alert channel", body: channelBody(), focus: 'input[name="ch-type"]:checked', back: "alerts",
        foot: '<button type="button" class="btn btn-secondary" data-action="toast" data-msg="Test alert sent">' + ico("send") + 'Send test</button><button type="button" class="btn btn-primary" data-action="save-close" data-msg="Channel added">Save channel</button>',
        after: function () { wireChannelTypes("ch-type", "ch-field", "ch-dest"); } });
    }
  }

  /* ---------------- per-view wiring ---------------- */
  function wireBase(base) {
    var q = $("#q");
    if (q) q.addEventListener("input", function () {
      var v = q.value.trim().toLowerCase(), any = false;
      $$(".mtable tr.row").forEach(function (tr) {
        var hit = !v || tr.dataset.name.indexOf(v) >= 0 || tr.textContent.toLowerCase().indexOf(v) >= 0;
        tr.hidden = !hit; if (hit) any = true;
        var d = tr.nextElementSibling; if (d && d.classList.contains("detail")) d.hidden = !hit || !tr.classList.contains("open");
      });
      $(".no-match").hidden = any;
    });
    if (base === "first-run") {
      wireChannelTypes("fr-ch", "fr-ch-field", "fr-dest");
      $("#first-form").addEventListener("submit", function (e) { e.preventDefault(); app.created = true; location.hash = "#monitor-pending"; });
    }
    if (base === "status-page") wireStatusPage();
  }

  function wireStatusPage() {
    var root = $("#sp-sections");
    function rerender(focusSel) {
      root.innerHTML = renderSections(false);
      if (focusSel) { var f = $(focusSel, root); if (f) f.focus(); }
    }
    root.addEventListener("input", function (e) {
      var t = e.target;
      if (t.getAttribute("role") === "combobox") {
        var i = +t.dataset.sec, list = $("#pick-list-" + i);
        list.innerHTML = pickerOptions(i, t.value); list.hidden = false; t.setAttribute("aria-expanded", "true");
      } else if (/^sec-name-/.test(t.id)) {
        spSections[+t.id.split("-")[2]].title = t.value;
      } else if (/^pn-/.test(t.id)) {
        var m = find(t.id.slice(3)); if (m) m.publicName = t.value;
      }
    });
    root.addEventListener("focusin", function (e) {
      var t = e.target;
      if (t.getAttribute("role") === "combobox") { var list = $("#pick-list-" + t.dataset.sec); list.innerHTML = pickerOptions(+t.dataset.sec, t.value); list.hidden = false; t.setAttribute("aria-expanded", "true"); }
    });
    root.addEventListener("keydown", function (e) {
      var t = e.target;
      if (t.getAttribute("role") === "combobox") {
        var list = $("#pick-list-" + t.dataset.sec), opts = $$('li[data-slug]', list), cur = opts.findIndex(function (o) { return o.getAttribute("aria-selected") === "true"; });
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault(); if (!opts.length) return;
          var n = e.key === "ArrowDown" ? Math.min(opts.length - 1, cur + 1) : Math.max(0, cur - 1);
          opts.forEach(function (o, i) { o.setAttribute("aria-selected", String(i === n)); });
          t.setAttribute("aria-activedescendant", opts[n].id);
        } else if (e.key === "Enter") {
          e.preventDefault(); if (opts[cur]) addTo(+t.dataset.sec, opts[cur].dataset.slug);
        } else if (e.key === "Escape" && !list.hidden) {
          e.preventDefault(); e.stopPropagation(); list.hidden = true; t.setAttribute("aria-expanded", "false");
        }
      } else if (t.classList.contains("handle") && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        var li = t.closest(".sp-item"), s = +li.dataset.sec, items = spSections[s].items, idx = items.indexOf(li.dataset.slug), to = idx + (e.key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= items.length) return;
        items.splice(to, 0, items.splice(idx, 1)[0]);
        rerender('.sp-item[data-slug="' + li.dataset.slug + '"] .handle');
        toast("Moved " + find(li.dataset.slug).name + " to position " + (to + 1));
      }
    });
    function addTo(i, s) {
      spSections[i].items.push(s);
      rerender("#pick-" + i);
      toast("Added " + find(s).name + " to " + spSections[i].title);
    }
    root.addEventListener("mousedown", function (e) {
      var li = e.target.closest(".picker-list li[data-slug]");
      if (li) { e.preventDefault(); addTo(+li.closest(".picker-list").id.split("-")[2], li.dataset.slug); }
    });
    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-action]"); if (!b) return;
      var sec = b.closest(".sp-section"), i = sec ? +sec.dataset.sec : -1, a = b.dataset.action;
      if (a === "sp-remove") {
        var li = b.closest(".sp-item"), items = spSections[i].items; items.splice(items.indexOf(li.dataset.slug), 1);
        rerender("#pick-" + i); toast("Removed from " + spSections[i].title);
      } else if (a === "sec-up" || a === "sec-down") {
        var to = i + (a === "sec-up" ? -1 : 1); spSections.splice(to, 0, spSections.splice(i, 1)[0]);
        rerender("#sec-name-" + to);
      } else if (a === "sec-remove") {
        var t = spSections[i].title; spSections.splice(i, 1); rerender(); toast("Removed section " + t + ". Its monitors are still being watched.");
      }
    });
    // Drag and drop between and within sections.
    var dragSlug = null;
    root.addEventListener("dragstart", function (e) {
      var li = e.target.closest && e.target.closest(".sp-item"); if (!li) return;
      dragSlug = li.dataset.slug; li.classList.add("dragging");
      try { e.dataTransfer.setData("text/plain", dragSlug); e.dataTransfer.effectAllowed = "move"; } catch (x) { /* ignore */ }
    });
    root.addEventListener("dragover", function (e) {
      if (!dragSlug) return; e.preventDefault();
      $$(".drop-target", root).forEach(function (x) { x.classList.remove("drop-target"); });
      var li = e.target.closest(".sp-item"); if (li) li.classList.add("drop-target");
    });
    root.addEventListener("drop", function (e) {
      if (!dragSlug) return; e.preventDefault();
      var sec = e.target.closest(".sp-section"); if (!sec) return;
      var to = +sec.dataset.sec, li = e.target.closest(".sp-item");
      spSections.forEach(function (s) { var k = s.items.indexOf(dragSlug); if (k >= 0) s.items.splice(k, 1); });
      var items = spSections[to].items, at = li ? items.indexOf(li.dataset.slug) : items.length;
      items.splice(at < 0 ? items.length : at, 0, dragSlug);
      dragSlug = null; rerender();
    });
    root.addEventListener("dragend", function () { dragSlug = null; $$(".dragging, .drop-target", root).forEach(function (x) { x.classList.remove("dragging", "drop-target"); }); });
    document.addEventListener("click", function (e) {
      if (!root.isConnected) return;
      if (!e.target.closest(".picker")) $$(".picker-list", root).forEach(function (l) { l.hidden = true; var c = $("#pick-" + l.id.split("-")[2]); if (c) c.setAttribute("aria-expanded", "false"); });
    });
  }

  /* ---------------- global actions ---------------- */
  var toastTimer;
  function toast(msg) {
    var t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }
  document.addEventListener("click", function (e) {
    var row = e.target.closest("tr.row");
    var b = e.target.closest("[data-action]");
    if (!b && row && !e.target.closest("a,button,input")) b = $(".name-btn", row);
    if (!b) return;
    var a = b.dataset.action;
    if (a === "skip") { e.preventDefault(); $("#main").focus(); return; }
    if (a === "close-drawer") return closeDrawer();
    if (a === "toast") return toast(b.dataset.msg);
    if (a === "save-close") { toast(b.dataset.msg); return closeDrawer(); }
    if (a === "toggle-row") {
      var tr = b.closest("tr"), open = b.getAttribute("aria-expanded") !== "true";
      b.setAttribute("aria-expanded", String(open)); tr.classList.toggle("open", open);
      $("#" + b.getAttribute("aria-controls")).hidden = !open;
      if (row && b !== e.target.closest("button")) b.focus();
      return;
    }
    if (a === "hide-checklist") { app.checklistHidden = true; var c = $(".checklist"); if (c) c.remove(); $("#new-monitor").focus(); toast("Checklist hidden. Find it again in the account menu."); return; }
    if (a === "ask-delete") {
      var box = $("#del-confirm"); box.hidden = !box.hidden;
      var trig = $('[data-action="ask-delete"][aria-controls]'); trig.setAttribute("aria-expanded", String(!box.hidden));
      (box.hidden ? trig : $(".btn-danger-solid", box)).focus(); return;
    }
    if (a === "copy") {
      var txt = $("#" + b.dataset.target).textContent;
      try { navigator.clipboard.writeText(txt).catch(function () {}); } catch (x) { /* ignore */ }
      var old = b.innerHTML; b.innerHTML = ico("check", "i-sm") + "Copied"; setTimeout(function () { b.innerHTML = old; }, 1800);
      return toast("Copied to the clipboard");
    }
    if (a === "first-test") {
      var dest = $("#fr-dest"), kind = ($('input[name="fr-ch"]:checked') || {}).value;
      var t = CH_TYPES.filter(function (x) { return x.type === kind; })[0];
      $("#fr-test").innerHTML = '<p class="callout info">' + ico("up") + "<span><strong>Test alert sent" + (dest && dest.value ? " to " + esc(dest.value) : "") + ".</strong> It should arrive in a few seconds by " + t.label + ". Nothing there? Check the " + t.field.toLowerCase() + ".</span></p>";
      return;
    }
    if (a === "sec-add") {
      spSections.push({ title: "New section", items: [] });
      $("#sp-sections").innerHTML = renderSections(false);
      var inp = $("#sec-name-" + (spSections.length - 1)); inp.focus(); inp.select(); return;
    }
    if (a === "scrollto") { var el = $("#" + b.dataset.target); el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); el.setAttribute("tabindex", "-1"); el.focus({ preventScroll: true }); }
  });

  // User menu
  var ub = $("#user-btn"), um = $("#user-menu");
  ub.addEventListener("click", function (e) { e.stopPropagation(); var o = um.hidden; um.hidden = !o; ub.setAttribute("aria-expanded", String(o)); });
  document.addEventListener("click", function (e) { if (!um.hidden && !e.target.closest(".user")) { um.hidden = true; ub.setAttribute("aria-expanded", "false"); } });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !um.hidden) { um.hidden = true; ub.setAttribute("aria-expanded", "false"); ub.focus(); } });

  // Nav badge: how many things are down.
  var downN = monitors.filter(function (m) { return m.state === "down"; }).length;
  var badge = $("#down-badge");
  if (downN) { badge.hidden = false; badge.innerHTML = downN + '<span class="sr-only"> down</span>'; }
  $("#site-name").textContent = SITE;

  window.addEventListener("hashchange", route);
  route();
})();
