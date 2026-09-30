/* Uptellis mock-up: dashboard. Renders window.UPTELLIS_DEMO[<hash state>] (a SiteView) into #app. */
(function () {
  "use strict";

  var DEMO = window.UPTELLIS_DEMO || {};
  var STATES = ["healthy", "incident", "stale"];
  var loadedAt = Date.now();

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pct(r, digits) {
    if (r == null) return "n/a";
    if (r >= 1) return "100%";
    return (r * 100).toFixed(digits == null ? 2 : digits) + "%";
  }
  function ms(v) {
    if (v == null) return "n/a";
    return Math.round(v) + "";
  }
  function ago(s) {
    if (s == null) return "never";
    s = Math.max(0, Math.round(s));
    if (s < 60) return s + " s ago";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    return Math.floor(s / 86400) + " d ago";
  }
  function dur(s) {
    s = Math.max(0, Math.round(s || 0));
    if (s < 60) return s + " s";
    var m = Math.floor(s / 60);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60);
    if (h < 24) return h + " h" + (m % 60 ? " " + (m % 60) + " min" : "");
    var d = Math.floor(h / 24);
    return d + " d" + (h % 24 ? " " + (h % 24) + " h" : "");
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function when(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + ", " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + " UTC";
  }
  function day(iso) {
    var d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
    if (isNaN(d.getTime())) return iso;
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()];
  }
  function initials(name) {
    var parts = String(name || "?").trim().split(/\s+/);
    return ((parts[0] || "?")[0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }

  /* State words, colours and icons: a state is never colour alone. */
  var STATE = {
    up: { label: "Operational", color: "var(--up)", icon: "check" },
    degraded: { label: "Degraded", color: "var(--degraded)", icon: "warn" },
    pending: { label: "Pending", color: "var(--degraded)", icon: "question" },
    down: { label: "Down", color: "var(--down)", icon: "x" },
    maintenance: { label: "Maintenance", color: "var(--maint)", icon: "wrench" },
    paused: { label: "Paused", color: "var(--stale)", icon: "pause" },
    unknown: { label: "Unknown", color: "var(--stale)", icon: "question" },
    stale: { label: "Stale", color: "var(--stale)", icon: "clock" }
  };
  var VERDICT_ICON = { operational: "check", degraded: "warn", outage: "x", stale: "clock", empty: "question" };
  var VERDICT_WORD = { operational: "Operational", degraded: "Degraded", outage: "Outage", stale: "Stale data", empty: "No data" };
  var LEVEL_COLOR = { ok: "var(--up)", warn: "var(--degraded)", crit: "var(--down)", info: "var(--stale)" };
  var LEVEL_CLASS = { ok: "st-up", warn: "st-degraded", crit: "st-down", info: "st-unknown" };

  var ICON_PATH = {
    check: '<path d="M4.5 8.5l2.3 2.3L11.5 5.8"/>',
    x: '<path d="M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6"/>',
    warn: '<path d="M8 4.2v4.6M8 11.4v.4"/>',
    question: '<path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.6-.8 1.2M8 11.5v.3"/>',
    clock: '<circle cx="8" cy="8" r="4.2"/><path d="M8 5.8V8l1.5 1"/>',
    pause: '<path d="M6.3 5v6M9.7 5v6"/>',
    wrench: '<path d="M10.8 4.2a2.6 2.6 0 0 0-3.2 3.3L4.3 10.8l.9.9 3.3-3.3a2.6 2.6 0 0 0 3.3-3.2l-1.5 1.5-1.2-.3-.3-1.2z"/>',
    pulse: '<path d="M2.5 8.5h2.3l1.5-3.5 2.5 6 1.6-3.5h3.1"/>',
    uptime: '<path d="M3 11.5l3-3 2 2 5-5.5M10 5h3v3"/>',
    heart: '<path d="M8 12.5S3 9.6 3 6.4A2.4 2.4 0 0 1 8 5a2.4 2.4 0 0 1 5 1.4c0 3.2-5 6.1-5 6.1z"/>',
    link: '<path d="M6.5 9.5l3-3M7 4.8l.9-.9a2.5 2.5 0 0 1 3.5 3.5l-.9.9M9 11.2l-.9.9a2.5 2.5 0 0 1-3.5-3.5l.9-.9"/>',
    alert: '<path d="M8 2.8l5.6 9.7H2.4z"/><path d="M8 6.8v2.6M8 11.1v.2"/>'
  };
  function icon(name, size) {
    var s = size || 12;
    return '<svg aria-hidden="true" width="' + s + '" height="' + s + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (ICON_PATH[name] || "") + "</svg>";
  }
  function pill(state) {
    var m = STATE[state] || STATE.unknown;
    return '<span class="pill st-' + esc(STATE[state] ? state : "unknown") + '"><span class="ic">' + icon(m.icon, 11) + "</span>" + esc(m.label) + "</span>";
  }
  function tickColor(worst) {
    if (worst == null) return "var(--empty-tick)";
    return (STATE[worst] || STATE.unknown).color;
  }

  /* ---------- charts (inline SVG drawn from the data) ---------- */
  var uid = 0;

  function donut(summary, verdictState) {
    var parts = [
      { k: "up", n: summary.up, label: "Operational", color: "var(--up)" },
      { k: "degraded", n: summary.degraded, label: "Degraded", color: "var(--degraded)" },
      { k: "down", n: summary.down, label: "Down", color: "var(--down)" },
      { k: "maintenance", n: summary.maintenance, label: "Maintenance", color: "var(--maint)" },
      { k: "other", n: summary.other, label: verdictState === "stale" ? "Stale" : "Other", color: "var(--stale)" }
    ];
    var r = 50, c = 2 * Math.PI * r, total = summary.total || 0, off = 0;
    var gap = total > 1 ? 3 : 0;
    var segs = parts.filter(function (p) { return p.n > 0; }).map(function (p) {
      var len = (p.n / total) * c;
      var seg = '<circle cx="64" cy="64" r="' + r + '" fill="none" stroke="' + p.color + '" stroke-width="14" stroke-linecap="butt" stroke-dasharray="' + Math.max(0, len - (parts.filter(function (q) { return q.n > 0; }).length > 1 ? gap : 0)).toFixed(2) + " " + c.toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '"/>';
      off += len;
      return seg;
    }).join("");
    var big, small;
    if (verdictState === "stale") { big = summary.other + "/" + total; small = "not current"; }
    else if (verdictState === "empty") { big = "0"; small = "services"; }
    else { big = summary.up + "/" + total; small = "services up"; }
    var desc = parts.filter(function (p) { return p.n > 0; }).map(function (p) { return p.n + " " + p.label.toLowerCase(); }).join(", ");
    var svg = '<div class="donut" role="img" aria-label="' + esc(total + " services: " + (desc || "none")) + '">' +
      '<svg viewBox="0 0 128 128"><circle cx="64" cy="64" r="' + r + '" fill="none" stroke="var(--line-soft)" stroke-width="14"/>' + segs + "</svg>" +
      '<div class="center"><strong class="num">' + esc(big) + "</strong><span>" + esc(small) + "</span></div></div>";
    var legend = '<ul class="legend">' + parts.map(function (p) {
      return '<li><span class="sw" style="background:' + p.color + '"></span>' + esc(p.label) + '<b class="num">' + p.n + "</b></li>";
    }).join("") + "</ul>";
    return { svg: svg, legend: legend };
  }

  /** Area sparkline of latency points (oldest first). */
  function sparkline(points, color, label) {
    var id = "g" + (++uid);
    var w = 200, h = 44, pad = 4;
    var min = Math.min.apply(null, points), max = Math.max.apply(null, points);
    if (max - min < 1) { max += 1; min -= 1; }
    var range = max - min;
    var xy = points.map(function (v, i) {
      var x = points.length === 1 ? w : (i / (points.length - 1)) * w;
      var y = pad + (1 - (v - min) / range) * (h - pad * 2);
      return [x, y];
    });
    var line = xy.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    var area = line + " L" + w + " " + h + " L0 " + h + " Z";
    return '<svg class="spark" viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '">' +
      '<defs><linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity="0.28"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#' + id + ')"/>' +
      '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>';
  }

  /** Recent checks as a strip of small ticks, oldest first. */
  function checksStrip(recent) {
    if (!recent || !recent.length) return "";
    var list = recent.slice().reverse();
    var counts = {};
    list.forEach(function (b) { counts[b.status] = (counts[b.status] || 0) + 1; });
    var desc = Object.keys(counts).map(function (k) { return counts[k] + " " + (STATE[k] ? STATE[k].label.toLowerCase() : k); }).join(", ");
    return '<div class="checks" role="img" aria-label="' + esc("Last " + list.length + " checks: " + desc) + '">' +
      list.map(function (b) {
        return '<i style="background:' + tickColor(b.status) + '" title="' + esc(when(b.ts) + ": " + (STATE[b.status] ? STATE[b.status].label : b.status) + (b.latencyMs != null ? ", " + b.latencyMs + " ms" : "") + (b.message ? ", " + b.message : "")) + '"></i>';
      }).join("") + "</div>";
  }

  /** 90 daily ticks for one service. */
  function bars90(svc) {
    var n = svc.beats90d.length || 90, w = 3, gap = 1;
    var width = n * (w + gap) - gap;
    var rects = svc.beats90d.map(function (b, i) {
      var tip = day(b.day) + ": " + (b.worst ? (STATE[b.worst] ? STATE[b.worst].label : b.worst) : "No data") + (b.uptime != null ? ", " + pct(b.uptime) : "") + (b.minutesDown ? ", " + b.minutesDown + " min down" : "");
      return '<rect x="' + i * (w + gap) + '" y="0" width="' + w + '" height="26" rx="1" fill="' + tickColor(b.worst) + '"><title>' + esc(tip) + "</title></rect>";
    }).join("");
    var bad = svc.beats90d.filter(function (b) { return b.worst === "down"; }).length;
    var warn = svc.beats90d.filter(function (b) { return b.worst === "degraded" || b.worst === "pending"; }).length;
    var label = "90-day history, " + bad + " days with downtime, " + warn + " degraded days: " + svc.beatsText;
    return '<svg class="bars90" viewBox="0 0 ' + width + ' 26" preserveAspectRatio="none" role="img" aria-label="' + esc(label) + '">' + rects + "</svg>";
  }

  /** Site-wide 90-day uptime column chart: mean daily uptime across services, coloured by the day's worst state. */
  function siteHistory(services) {
    var n = 0;
    services.forEach(function (s) { n = Math.max(n, s.beats90d.length); });
    var days = [];
    var rank = { down: 5, degraded: 4, pending: 3, maintenance: 2, up: 1 };
    for (var i = 0; i < n; i++) {
      var sum = 0, cnt = 0, worst = null, mins = 0, date = null;
      services.forEach(function (s) {
        var b = s.beats90d[i];
        if (!b) return;
        date = date || b.day;
        if (b.uptime != null) { sum += b.uptime; cnt++; }
        mins += b.minutesDown || 0;
        if (b.worst && (worst == null || (rank[b.worst] || 0) > (rank[worst] || 0))) worst = b.worst;
      });
      days.push({ day: date, uptime: cnt ? sum / cnt : null, worst: worst, minutesDown: mins });
    }
    var known = days.filter(function (d) { return d.uptime != null; });
    var mean = known.length ? known.reduce(function (a, d) { return a + d.uptime; }, 0) / known.length : null;
    var minU = known.length ? Math.min.apply(null, known.map(function (d) { return d.uptime; })) : 1;
    var floor = Math.min(0.995, Math.floor((minU - 0.0005) * 1000) / 1000);
    var W = 900, H = 140, bw = W / Math.max(1, n), inner = Math.max(1, bw - 2);
    var grid = [0, 0.5, 1].map(function (t) { var y = (t * (H - 2) + 1).toFixed(1); return '<line x1="0" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="var(--line)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>'; }).join("");
    var cols = days.map(function (d, idx) {
      var x = (idx * bw + 1).toFixed(1);
      if (d.uptime == null) return '<rect x="' + x + '" y="' + (H - 6) + '" width="' + inner.toFixed(1) + '" height="6" rx="1.5" fill="var(--empty-tick)"><title>' + esc(day(d.day || "") + ": no data") + "</title></rect>";
      var t = Math.max(0.04, (d.uptime - floor) / (1 - floor));
      var h = Math.max(6, t * H);
      var tip = day(d.day || "") + ": " + pct(d.uptime, 3) + " mean uptime" + (d.minutesDown ? ", " + d.minutesDown + " service-min down" : "") + ", worst " + (STATE[d.worst] ? STATE[d.worst].label : "n/a");
      return '<rect x="' + x + '" y="' + (H - h).toFixed(1) + '" width="' + inner.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="1.5" fill="' + tickColor(d.worst) + '" fill-opacity="' + (d.worst === "up" ? 0.78 : 1) + '"><title>' + esc(tip) + "</title></rect>";
    }).join("");
    var incidentDays = days.filter(function (d) { return d.worst === "down"; }).length;
    var degradedDays = days.filter(function (d) { return d.worst === "degraded" || d.worst === "pending"; }).length;
    var totalDown = days.reduce(function (a, d) { return a + d.minutesDown; }, 0);
    var first = days[0] && days[0].day, last = days[n - 1] && days[n - 1].day;
    var mid = days[Math.floor(n / 2)] && days[Math.floor(n / 2)].day;
    return {
      mean: mean, incidentDays: incidentDays, degradedDays: degradedDays, totalDown: totalDown,
      html: '<div class="chart"><div class="y num" aria-hidden="true"><span>100%</span><span>' + esc(((1 + floor) / 2 * 100).toFixed(2)) + "%</span><span>" + esc((floor * 100).toFixed(1)) + "%</span></div>" +
        '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc("Daily mean uptime over " + n + " days, " + incidentDays + " days with downtime, " + degradedDays + " degraded days") + '">' + grid + cols + "</svg>" +
        '<div class="x" aria-hidden="true"><span>' + esc(first ? day(first) : "") + "</span><span>" + esc(mid ? day(mid) : "") + "</span><span>Today</span></div></div>"
    };
  }

  /** Small bar chart of each service's current latency, for the latency KPI. */
  function latencyBars(services) {
    var vals = services.map(function (s) { return { name: s.name, v: s.latencyMs }; });
    var max = Math.max.apply(null, vals.map(function (x) { return x.v || 0; }).concat([1]));
    var W = 200, H = 34, n = vals.length || 1, bw = W / n;
    return '<svg class="mini" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' + vals.map(function (x, i) {
      var h = x.v == null ? 3 : Math.max(3, (x.v / max) * H);
      return '<rect x="' + (i * bw + 2).toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + Math.max(2, bw - 4).toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + (x.v == null ? "var(--down)" : "var(--accent)") + '" fill-opacity="' + (x.v == null ? 1 : 0.75) + '"><title>' + esc(x.name + ": " + (x.v == null ? "no response" : x.v + " ms")) + "</title></rect>";
    }).join("") + "</svg>";
  }

  /* ---------- sections of the page ---------- */
  function allServices(v) {
    var out = [];
    v.sections.forEach(function (s) { out = out.concat(s.services); });
    return out.concat(v.unsectioned || []);
  }

  function header(v) {
    var f = v.freshness;
    var cls = f.state === "stale" || f.state === "empty" ? "is-stale" : f.state === "aging" ? "is-aging" : "";
    var fresh = f.ageS == null ? "No data received yet" : "Updated <span data-age=\"" + f.ageS + "\">" + esc(ago(f.ageS)) + "</span>";
    var host = (v.site.hostnames && v.site.hostnames[0]) || "";
    var title = v.branding.title || v.site.name;
    return '<header class="top-bar"><div class="brand"><div class="logo" aria-hidden="true">' + esc(initials(title)) + "</div><div>" +
      "<h1>" + esc(v.site.name) + "</h1>" +
      '<p class="sub">' + esc(v.branding.tagline || (host ? host + " · System status" : "System status")) + "</p></div></div>" +
      '<div class="bar-meta"><span class="chip ' + cls + '"><span class="live-dot" aria-hidden="true"></span>' + fresh + "</span></div></header>";
  }

  function staleBanner(v) {
    var f = v.freshness;
    if (f.state === "fresh" || f.quietForMaintenance) return "";
    var src = f.perSource.filter(function (s) { return s.id === f.stalestSourceId; })[0];
    var title = f.state === "aging" ? "Data is getting old" : f.state === "empty" ? "No data has been received" : "This data is out of date";
    var body = f.ageS != null
      ? "The newest report from " + (src ? src.id : "a monitoring source") + " is <strong data-age-plain=\"" + f.ageS + "\">" + esc(dur(f.ageS)) + "</strong> old" + (src ? " (expected every " + esc(dur(src.expectedIntervalS)) + ")" : "") + ". Service states below are from the last report and may not reflect what is happening now."
      : "No monitoring source has reported yet.";
    return '<section class="banner stale" role="alert" aria-labelledby="stale-h"><span class="b-icon">' + icon("clock", 20) + "</span><div>" +
      '<h2 id="stale-h">' + esc(title) + "</h2><p>" + body + "</p></div></section>";
  }

  function maintenanceBanner(v) {
    var list = v.maintenance || [];
    if (!list.length) return "";
    var names = {};
    allServices(v).forEach(function (s) { names[s.id] = s.name; });
    return list.map(function (m) {
      var covers = m.services.length ? m.services.map(function (id) { return names[id] || id; }).join(", ") : "All services";
      return '<section class="banner maint" aria-label="Scheduled maintenance"><span class="b-icon">' + icon("wrench", 20) + "</span><div>" +
        "<h2>Maintenance: " + esc(m.title) + "</h2><p>" + esc(when(m.start)) + " to " + esc(when(m.end)) + ". Affects: " + esc(covers) + ".</p></div></section>";
    }).join("");
  }

  function openIncidents(v) {
    var list = v.incidents.open;
    if (!list.length) return "";
    return '<section class="card open-incidents" aria-labelledby="oi-h"><div class="card-head"><h2 id="oi-h">' + icon("alert", 16) + " Active incident" + (list.length > 1 ? "s (" + list.length + ")" : "") + '</h2><span class="hint">Live</span></div>' +
      list.map(function (i) {
        return '<article class="oi"><div><h3>' + esc(i.title) + '</h3><p class="meta">' + esc(i.subject) + " · started " + esc(when(i.startedAt)) + "</p></div>" +
          '<div class="dur"><strong class="num" data-dur="' + i.durationS + '">' + esc(dur(i.durationS)) + "</strong><span>ongoing</span></div>" +
          (i.notes ? '<p class="notes">' + esc(i.notes) + "</p>" : "") +
          '<ol class="steps">' + i.steps.map(function (s) {
            return '<li><span class="dot" style="background:' + (LEVEL_COLOR[s.level] || "var(--stale)") + '" aria-hidden="true"></span><strong>' + esc(s.label) + "</strong> " + esc(when(s.ts)) + "</li>";
          }).join("") + "</ol></article>";
      }).join("") + "</section>";
  }

  function overview(v, services) {
    var d = donut(v.summary, v.verdict.state);
    var s = v.summary;
    var st = v.verdict.state;
    var verdict = '<section class="card verdict-card" data-state="' + esc(st) + '" aria-labelledby="verdict-h">' + d.svg +
      '<div class="verdict-body"><span class="verdict-pill"><span class="ic">' + icon(VERDICT_ICON[st] || "question", 11) + "</span>" + esc(VERDICT_WORD[st] || st) + "</span>" +
      '<h2 id="verdict-h" class="verdict-label">' + esc(v.verdict.label) + "</h2>" +
      (v.headline ? '<p class="verdict-headline">' + esc(v.headline) + "</p>" : "") + d.legend + "</div></section>";

    var hs = s.healthScore;
    var kpis = '<div class="kpis">' +
      '<section class="card kpi" aria-label="Average latency"><div class="kpi-top"><span class="eyebrow">Avg latency</span><span class="kpi-ic">' + icon("pulse", 16) + "</span></div>" +
      '<p class="value num">' + esc(ms(s.avgLatencyMs)) + (s.avgLatencyMs != null ? "<small>ms</small>" : "") + "</p>" + latencyBars(services) + '<p class="foot">Latest check, per service</p></section>' +
      '<section class="card kpi" aria-label="Uptime, last 24 hours"><div class="kpi-top"><span class="eyebrow">Uptime 24h</span><span class="kpi-ic">' + icon("uptime", 16) + "</span></div>" +
      '<p class="value num">' + esc(pct(s.uptime24h)) + "</p>" + '<div class="meter" aria-hidden="true"><span style="width:' + (s.uptime24h == null ? 0 : (s.uptime24h * 100).toFixed(2)) + '%"></span></div><p class="foot">Mean across services</p></section>' +
      '<section class="card kpi" aria-label="Uptime, last 30 days"><div class="kpi-top"><span class="eyebrow">Uptime 30d</span><span class="kpi-ic">' + icon("uptime", 16) + "</span></div>" +
      '<p class="value num">' + esc(pct(s.uptime30d)) + "</p>" + '<div class="meter" aria-hidden="true"><span style="width:' + (s.uptime30d == null ? 0 : (s.uptime30d * 100).toFixed(2)) + '%"></span></div><p class="foot">Mean across services</p></section>' +
      '<section class="card kpi" aria-label="Health score"><div class="kpi-top"><span class="eyebrow">Health score</span><span class="kpi-ic">' + icon("heart", 16) + "</span></div>" +
      '<p class="value num">' + (hs == null ? "n/a" : esc(hs.toFixed(1)) + "<small>/100</small>") + "</p>" + '<div class="meter" aria-hidden="true"><span style="width:' + (hs == null ? 0 : hs) + '%"></span></div><p class="foot">Uptime, latency and certificates</p></section>' +
      "</div>";
    return '<div class="overview">' + verdict + kpis + "</div>";
  }

  function history(services) {
    if (!services.length) return "";
    var h = siteHistory(services);
    return '<section class="card history" aria-labelledby="hist-h"><div class="card-head"><div><h2 id="hist-h">90-day uptime</h2><p class="hint">Daily mean across all services</p></div>' +
      '<div class="history-stats"><div><strong class="num">' + esc(pct(h.mean, 3)) + "</strong><span>Average</span></div>" +
      '<div><strong class="num">' + h.incidentDays + "</strong><span>Days with downtime</span></div>" +
      '<div><strong class="num">' + esc(dur(h.totalDown * 60)) + "</strong><span>Service downtime</span></div></div></div>" +
      h.html +
      '<div class="chart-key" aria-hidden="true"><span><i style="background:var(--up)"></i>Operational</span><span><i style="background:var(--degraded)"></i>Degraded</span><span><i style="background:var(--down)"></i>Downtime</span><span><i style="background:var(--maint)"></i>Maintenance</span><span><i style="background:var(--empty-tick)"></i>No data</span></div></section>';
  }

  function serviceCard(s) {
    var m = STATE[s.state] || STATE.unknown;
    var lineColor = s.state === "stale" ? "var(--stale)" : s.state === "down" ? "var(--down)" : s.state === "degraded" ? "var(--degraded)" : "var(--accent)";
    var chart;
    if (s.spark && s.spark.length >= 2) {
      chart = sparkline(s.spark, lineColor, "Latency trend over the last " + s.spark.length + " checks, from " + Math.round(s.spark[0]) + " to " + Math.round(s.spark[s.spark.length - 1]) + " ms");
    } else if (s.state === "down") {
      chart = '<p class="spark-empty">No response to recent checks</p>';
    } else {
      chart = '<p class="spark-empty" style="color:var(--text-3)">Not enough latency data</p>';
    }
    var lastMsg = s.recent && s.recent[0] && s.recent[0].message;
    var latLabel = s.state === "down" ? "no response" + (lastMsg ? " (" + lastMsg + ")" : "") : "latency" + (s.avgLatencyMs != null ? ", avg " + Math.round(s.avgLatencyMs) + " ms" : "");
    var hs = s.health;
    var reasons = s.state !== "up" && hs.reasons && hs.reasons.length ? '<p class="reasons">' + esc(hs.reasons.join("; ")) + "</p>" : "";
    var cert = s.cert ? (s.cert.valid ? s.cert.daysRemaining + " d" : "invalid") : "n/a";
    var first = s.beats90d[0] && s.beats90d[0].day;
    return '<li class="card svc" data-state="' + esc(s.state) + '"><div class="svc-head"><div><h3>' + esc(s.name) + '</h3><p class="target"><span class="kind">' + esc(s.kind) + "</span>" + esc(s.targetDisplay || "") + "</p></div>" + pill(s.state) + "</div>" +
      '<div class="svc-metrics"><div class="lat"><strong class="num">' + (s.latencyMs == null ? "n/a" : esc(ms(s.latencyMs)) + "<small>ms</small>") + "</strong><span>" + esc(latLabel) + "</span></div>" + chart + "</div>" +
      checksStrip(s.recent) +
      '<dl class="svc-stats"><div><dt>Uptime 24h</dt><dd>' + esc(pct(s.uptime24h)) + "</dd></div><div><dt>Uptime 30d</dt><dd>" + esc(pct(s.uptime30d)) + "</dd></div><div><dt>" + (s.cert ? "Certificate" : "Health") + "</dt><dd>" + esc(s.cert ? cert : (hs.score == null ? "n/a" : hs.score.toFixed(1))) + "</dd></div></dl>" +
      '<div>' + bars90(s) + '<div class="bars90-foot" aria-hidden="true"><span>' + esc(first ? day(first) : "90 days ago") + "</span><span>Today</span></div></div>" +
      reasons + '<span class="sr-only">State: ' + esc(m.label) + "</span></li>";
  }

  function sectionBlock(id, title, state, services) {
    if (!services.length) return "";
    var up = services.filter(function (s) { return s.state === "up"; }).length;
    return '<section class="section" aria-labelledby="sec-' + esc(id) + '"><div class="section-head"><h2 id="sec-' + esc(id) + '">' + esc(title) + " " + pill(state) + '</h2><span class="count">' + up + " of " + services.length + " operational</span></div>" +
      '<ul class="services">' + services.map(serviceCard).join("") + "</ul></section>";
  }

  function recentIncidents(v) {
    var list = v.incidents.recent;
    var body = list.length ? '<ol class="inc-list">' + list.map(function (i) {
      var resolved = !!i.endedAt;
      return '<li><span class="node" style="background:' + (resolved ? "var(--up)" : "var(--down)") + '" aria-hidden="true"></span>' +
        "<h3>" + esc(i.title) + '<span class="tag ' + (resolved ? "st-up" : "st-down") + '">' + (resolved ? "Resolved" : "Ongoing") + "</span></h3>" +
        "<p>" + esc(when(i.startedAt)) + " · " + (resolved ? "lasted " : "for ") + esc(dur(i.durationS)) + "</p>" +
        (i.notes ? "<p>" + esc(i.notes) + "</p>" : "") + "</li>";
    }).join("") + "</ol>" : '<p class="empty-note">No incidents in the recent history.</p>';
    return '<section class="card" aria-labelledby="ri-h"><div class="card-head"><h2 id="ri-h">Recent incidents</h2><span class="hint">' + list.length + "</span></div>" + body + "</section>";
  }

  function sources(v) {
    var fw = { fresh: "up", aging: "degraded", stale: "down", empty: "unknown" };
    var fl = { fresh: "Fresh", aging: "Aging", stale: "Stale", empty: "No reports" };
    var icn = { fresh: "check", aging: "warn", stale: "clock", empty: "question" };
    return '<section class="card" aria-labelledby="src-h"><div class="card-head"><h2 id="src-h">Data sources</h2><span class="hint">' + v.freshness.perSource.length + "</span></div>" +
      '<ul class="src-list">' + v.freshness.perSource.map(function (s) {
        return '<li><div><p class="name">' + esc(s.id) + '</p><p class="age">' + esc(s.kind) + " · " + (s.ageS == null ? "never reported" : "last seen <span data-age=\"" + s.ageS + "\">" + esc(ago(s.ageS)) + "</span>") + "</p></div>" +
          '<span class="pill st-' + fw[s.freshness] + '"><span class="ic">' + icon(icn[s.freshness], 11) + "</span>" + esc(fl[s.freshness] || s.freshness) + "</span></li>";
      }).join("") + "</ul></section>";
  }

  function facts(v) {
    var list = v.highlights || [];
    if (!list.length) return "";
    return '<section class="card" aria-labelledby="facts-h"><div class="card-head"><h2 id="facts-h">System facts</h2></div><ul class="facts">' + list.map(function (h) {
      return '<li><span class="k">' + esc(h.row.label || h.label) + "</span><span class=\"v\">" + (h.prefix ? esc(h.prefix) + " " : "") + esc(h.row.display) +
        (h.note ? '<span class="note ' + (LEVEL_CLASS[h.note.level] || "st-unknown") + '">' + esc(h.note.text) + "</span>" : "") + "</span></li>";
    }).join("") + "</ul></section>";
  }

  function links(v) {
    var host = (v.site.hostnames || []).map(function (h) { return { label: h, href: "https://" + h }; });
    var list = (v.links || []).concat(host);
    if (!list.length) return "";
    return '<section class="card" aria-labelledby="links-h"><div class="card-head"><h2 id="links-h">Links</h2></div><ul class="links">' + list.map(function (l) {
      return '<li><a href="' + esc(l.href) + '" rel="noopener">' + esc(l.label) + icon("link", 14) + "</a></li>";
    }).join("") + "</ul></section>";
  }

  function footer(v) {
    return '<footer class="foot"><span>' + esc(v.site.name) + " · Snapshot " + esc(when(v.generatedAt)) + "</span><span>Powered by Uptellis</span></footer>";
  }

  /* ---------- render ---------- */
  function pick() {
    var h = (location.hash || "").replace(/^#/, "");
    return STATES.indexOf(h) >= 0 ? h : "healthy";
  }

  function render() {
    var v = DEMO[pick()];
    var app = document.getElementById("app");
    if (!v || !app) return;
    uid = 0;
    loadedAt = Date.now();
    var services = allServices(v);
    document.title = v.verdict.label + " · " + v.site.name;
    var body = v.sections.map(function (s) { return sectionBlock(s.id, s.title, s.state, s.services); }).join("") +
      sectionBlock("unsectioned", "Other services", (v.unsectioned[0] && v.unsectioned[0].state) || "unknown", v.unsectioned || []);
    app.innerHTML = header(v) +
      "<main>" + staleBanner(v) + maintenanceBanner(v) + openIncidents(v) + overview(v, services) + history(services) +
      '<div class="layout"><div class="main-col"><h2 class="sr-only">Services</h2>' + body + "</div>" +
      '<aside class="aside" aria-label="Details">' + recentIncidents(v) + sources(v) + facts(v) + links(v) + "</aside></div></main>" +
      footer(v);
  }

  /* Ages tick forward from the snapshot's `now`, once every 15 s (cheap, and no motion). */
  function tick() {
    var extra = (Date.now() - loadedAt) / 1000;
    var nodes = document.querySelectorAll("[data-age]");
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = ago(Number(nodes[i].getAttribute("data-age")) + extra);
    var plain = document.querySelectorAll("[data-age-plain]");
    for (var j = 0; j < plain.length; j++) plain[j].textContent = dur(Number(plain[j].getAttribute("data-age-plain")) + extra);
    var durs = document.querySelectorAll("[data-dur]");
    for (var k = 0; k < durs.length; k++) durs[k].textContent = dur(Number(durs[k].getAttribute("data-dur")) + extra);
  }

  render();
  window.addEventListener("hashchange", render);
  setInterval(tick, 15000);
})();
