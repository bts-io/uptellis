/* Classic status page mock-up: renders window.UPTELLIS_DEMO[state] (a SiteView) picked by the URL hash. */
(function () {
  "use strict";

  var STATES = ["healthy", "incident", "stale"];

  var STATE_LABEL = {
    up: "Operational",
    degraded: "Degraded",
    down: "Down",
    pending: "Pending",
    maintenance: "Maintenance",
    paused: "Paused",
    unknown: "Unknown",
    stale: "No recent data",
  };

  var ICON = {
    check: '<path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    warn: '<path d="M10 6.5v4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="10" cy="14" r="1.2" fill="currentColor"/>',
    cross: '<path d="M7 7l6 6M13 7l-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    wrench: '<path d="M6.5 13.5l4-4M11.5 6a2.5 2.5 0 1 0 2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    clock: '<path d="M10 6v4.2l2.6 1.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    pause: '<path d="M8 7v6M12 7v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
    question: '<path d="M8.2 8.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="14" r="1.1" fill="currentColor"/>',
  };

  var STATE_ICON = {
    up: "check", degraded: "warn", pending: "clock", down: "cross",
    maintenance: "wrench", paused: "pause", unknown: "question", stale: "clock",
  };

  function icon(name, cls) {
    // A ring plus a glyph: reads as a status icon at 16 to 28 px.
    return '<svg class="' + (cls || "") + '" viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
      '<circle cx="10" cy="10" r="8.6" fill="none" stroke="currentColor" stroke-width="1.6"/>' + ICON[name] + "</svg>";
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function d(iso) { return new Date(iso); }
  function fmtDay(iso) { var t = d(iso); return MONTHS[t.getUTCMonth()] + " " + t.getUTCDate() + ", " + t.getUTCFullYear(); }
  function fmtTime(iso) { var t = d(iso); return pad(t.getUTCHours()) + ":" + pad(t.getUTCMinutes()) + " UTC"; }
  function fmtDayTime(iso) { var t = d(iso); return MONTHS[t.getUTCMonth()] + " " + t.getUTCDate() + ", " + fmtTime(iso); }
  function dayKey(iso) { return String(iso).slice(0, 10); }

  function fmtDur(s) {
    if (s == null) return "";
    if (s < 60) return Math.max(1, Math.round(s)) + " sec";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60), rm = m % 60;
    if (h < 24) return h + " h" + (rm ? " " + rm + " min" : "");
    var dd = Math.floor(h / 24), rh = h % 24;
    return dd + " d" + (rh ? " " + rh + " h" : "");
  }
  function fmtAgo(s) {
    if (s == null) return "never";
    if (s < 60) return "just now";
    return fmtDur(s) + " ago";
  }
  function fmtPct(r) {
    if (r == null) return null;
    var p = r * 100;
    return (p >= 99.995 ? "100" : p.toFixed(2)) + "%";
  }

  function stateLabel(s) { return STATE_LABEL[s] || s; }
  function stateTag(s) {
    return '<span class="state" data-s="' + esc(s) + '">' + icon(STATE_ICON[s] || "question") + esc(stateLabel(s)) + "</span>";
  }

  function uptime90(days) {
    var sum = 0, n = 0;
    for (var i = 0; i < days.length; i++) if (days[i].uptime != null) { sum += days[i].uptime; n++; }
    return n ? sum / n : null;
  }

  function tickTitle(b) {
    var parts = [fmtDay(b.day + "T00:00:00Z")];
    if (b.worst == null) parts.push("No data");
    else {
      parts.push(stateLabel(b.worst));
      if (b.uptime != null) parts.push(fmtPct(b.uptime) + " uptime");
      if (b.minutesDown) parts.push(b.minutesDown + " min down");
    }
    return parts.join(", ");
  }

  function renderBar(svc) {
    var days = svc.beats90d || [];
    var ticks = days.map(function (b) {
      return '<span class="tick" data-w="' + esc(b.worst || "none") + '" title="' + esc(tickTitle(b)) + '"></span>';
    }).join("");
    var up = fmtPct(uptime90(days));
    var bad = days.filter(function (b) { return b.worst === "down"; }).length;
    var summary = "90-day history for " + svc.name + ": " + (up ? up + " uptime" : "no data") +
      (bad ? ", " + bad + (bad === 1 ? " day" : " days") + " with downtime" : "");
    return '<div class="bar" role="img" aria-label="' + esc(summary) + '" data-beats="' + esc(svc.beatsText) + '">' + ticks + "</div>" +
      '<div class="bar-foot" aria-hidden="true"><span>90 days ago</span><span class="rule"></span>' +
      '<span class="uptime">' + esc(up ? up + " uptime" : "No data") + '</span><span class="rule"></span><span>Today</span></div>';
  }

  function renderService(svc) {
    var lat = svc.latencyMs != null && svc.state !== "stale" && svc.state !== "down"
      ? '<span class="latency" title="Latest response time">' + Math.round(svc.latencyMs) + " ms</span>" : "";
    return '<li class="service" id="svc-' + esc(svc.id) + '">' +
      '<div class="service-top"><span class="service-name">' + esc(svc.name) + lat + "</span>" + stateTag(svc.state) + "</div>" +
      renderBar(svc) + "</li>";
  }

  function renderGroup(title, state, services, id) {
    if (!services.length) return "";
    return '<section class="group" aria-labelledby="g-' + esc(id) + '">' +
      '<div class="group-head"><h3 id="g-' + esc(id) + '">' + esc(title) + "</h3>" + stateTag(state) + "</div>" +
      '<ul class="services">' + services.map(renderService).join("") + "</ul></section>";
  }

  function worstState(services) {
    var order = ["down", "degraded", "stale", "pending", "unknown", "paused", "maintenance", "up"];
    var best = "unknown", rank = 99;
    services.forEach(function (s) { var r = order.indexOf(s.state); if (r >= 0 && r < rank) { rank = r; best = s.state; } });
    return best;
  }

  function brandMark() {
    return '<svg class="brand-mark" viewBox="0 0 36 36" aria-hidden="true" focusable="false">' +
      '<rect width="36" height="36" rx="9" fill="#1b2230"/>' +
      '<path d="M7 19h5.5l2.8-6.5 4.4 12 3.2-8.5H29" fill="none" stroke="#3ecf7a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function bannerSub(v) {
    var f = v.freshness;
    if (v.verdict.state === "stale") {
      return "Last update received " + fmtAgo(f.ageS) + ". The statuses below may no longer be accurate.";
    }
    if (v.verdict.state === "empty") return "No monitoring data has been received yet.";
    var bits = [];
    if (v.verdict.down) bits.push(v.verdict.down + (v.verdict.down === 1 ? " service is" : " services are") + " down");
    if (v.verdict.degraded) bits.push(v.verdict.degraded + (v.verdict.degraded === 1 ? " service is" : " services are") + " degraded");
    if (!bits.length) bits.push(v.summary.up + " of " + v.summary.total + " services operational");
    return bits.join(", ") + ". Updated " + fmtAgo(f.ageS) + ".";
  }

  function renderBanner(v) {
    var st = v.verdict.state;
    var ic = st === "operational" ? "check" : st === "degraded" ? "warn" : st === "outage" ? "cross" : st === "stale" ? "clock" : "question";
    return '<section class="banner" data-state="' + esc(st) + '" role="status" aria-live="polite">' +
      icon(ic, "banner-icon") +
      '<div class="banner-text"><h2>' + esc(v.verdict.label) + "</h2><p>" + esc(bannerSub(v)) + "</p></div></section>";
  }

  function renderFreshness(v) {
    var f = v.freshness;
    if (!f || f.state === "fresh" || f.quietForMaintenance) return "";
    var src = f.perSource.filter(function (s) { return s.id === f.stalestSourceId; })[0];
    var seen = src && src.lastSeenAt ? " (last data at " + fmtDayTime(src.lastSeenAt) + ")" : "";
    var title, body;
    if (f.state === "stale") {
      title = "Status data is out of date";
      body = "We have not received fresh monitoring data for " + fmtDur(f.ageS) + seen +
        ". The services below are shown as they were last reported and marked “No recent data” until monitoring reports again.";
    } else if (f.state === "aging") {
      title = "Status updates are delayed";
      body = "The newest monitoring data is " + fmtDur(f.ageS) + " old" + seen + ". It should refresh shortly.";
    } else {
      title = "Waiting for monitoring data";
      body = "No monitoring source has reported yet.";
    }
    return '<aside class="notice is-stale" role="alert">' + icon("clock") +
      "<div><h3>" + esc(title) + "</h3><p>" + esc(body) + "</p></div></aside>";
  }

  function renderMaintenance(v) {
    var list = v.maintenance || [];
    if (!list.length) return "";
    var names = {};
    v.sections.forEach(function (s) { s.services.forEach(function (x) { names[x.id] = x.name; }); });
    (v.unsectioned || []).forEach(function (x) { names[x.id] = x.name; });
    return list.map(function (m) {
      var scope = m.services.length
        ? "Affects " + m.services.map(function (id) { return names[id] || id; }).join(", ")
        : "Affects all services";
      return '<aside class="notice is-maint">' + icon("wrench") + "<div><h3>Scheduled maintenance: " + esc(m.title) + "</h3>" +
        "<p>" + esc(fmtDayTime(m.start)) + " to " + esc(fmtDayTime(m.end)) + ". " + esc(scope) + ".</p></div></aside>";
    }).join("");
  }

  function renderOpen(v) {
    var open = v.incidents.open || [];
    if (!open.length) return "";
    return '<section class="block" aria-labelledby="h-open"><div class="block-head"><h2 id="h-open">Active incidents</h2>' +
      '<span class="aside">' + open.length + (open.length === 1 ? " ongoing" : " ongoing") + "</span></div>" +
      open.map(function (inc) {
        var steps = (inc.steps || []).slice().reverse();
        return '<article class="open-incident"><header><h3>' + esc(inc.title) + "</h3>" +
          '<span class="since">Ongoing for ' + esc(fmtDur(inc.durationS)) + "</span></header>" +
          '<p class="affects">' + (inc.kind === "stale" ? "Monitoring source " : "Affected service: ") + "<strong>" + esc(inc.subject) + "</strong></p>" +
          (inc.notes ? '<p class="notes">' + esc(inc.notes) + "</p>" : "") +
          '<ol class="steps">' + steps.map(function (s) {
            return '<li><span class="step-label">' + esc(s.label) + '</span><time datetime="' + esc(s.ts) + '">' + esc(fmtDayTime(s.ts)) + "</time></li>";
          }).join("") + "</ol></article>";
      }).join("") + "</section>";
  }

  function renderHistory(v) {
    var recent = v.incidents.recent || [];
    var body;
    if (!recent.length) {
      body = '<p class="empty-note">No incidents reported recently.</p>';
    } else {
      var groups = [], byKey = {};
      recent.forEach(function (inc) {
        var k = dayKey(inc.startedAt);
        if (!byKey[k]) { byKey[k] = { key: k, items: [] }; groups.push(byKey[k]); }
        byKey[k].items.push(inc);
      });
      body = '<ol class="history">' + groups.map(function (g) {
        return '<li class="day"><h3><time datetime="' + esc(g.key) + '">' + esc(fmtDay(g.key + "T00:00:00Z")) + "</time></h3><ul>" +
          g.items.map(function (inc) {
            var resolved = inc.endedAt
              ? '<span class="resolved">Resolved</span> at ' + esc(fmtTime(inc.endedAt)) + " after " + esc(fmtDur(inc.durationS))
              : "Ongoing";
            return '<li class="past"><h4><span class="kind" data-k="' + esc(inc.kind) + '">' + (inc.kind === "stale" ? "Stale data" : "Outage") + "</span>" +
              esc(inc.title) + "</h4><p>Started " + esc(fmtTime(inc.startedAt)) + ". " + resolved + ".</p>" +
              (inc.notes ? "<p>" + esc(inc.notes) + "</p>" : "") + "</li>";
          }).join("") + "</ul></li>";
      }).join("") + "</ol>";
    }
    return '<section class="block" aria-labelledby="h-hist"><div class="block-head"><h2 id="h-hist">Past incidents</h2></div>' + body + "</section>";
  }

  function renderLegend() {
    var items = [["var(--up)", "Operational"], ["var(--degraded)", "Degraded"], ["var(--down)", "Down"], ["var(--maint)", "Maintenance"], ["var(--nodata)", "No data"]];
    return '<ul class="legend" aria-label="History legend">' + items.map(function (i) {
      return '<li><i style="background:' + i[0] + '"></i>' + i[1] + "</li>";
    }).join("") + "</ul>";
  }

  function render(v) {
    var name = v.branding.title || v.site.name;
    var host = (v.site.hostnames || [])[0];
    var html = "";
    html += '<header class="site-header"><div class="brand">' + brandMark(name) + "<div>" +
      '<h1 class="brand-name">' + esc(name) + "</h1>" +
      (v.branding.tagline ? '<p class="brand-tagline">' + esc(v.branding.tagline) + "</p>" : "") +
      (name !== v.site.name ? '<p class="brand-tagline">' + esc(v.site.name) + "</p>" : "") +
      "</div></div>" +
      '<div class="header-meta">System status<br><strong>as of <time datetime="' + esc(v.generatedAt) + '">' + esc(fmtDayTime(v.generatedAt)) + "</time></strong></div></header>";

    html += "<main>";
    html += renderBanner(v);
    html += renderFreshness(v);
    html += renderMaintenance(v);
    html += renderOpen(v);

    html += '<section class="block" aria-labelledby="h-svc"><div class="block-head"><h2 id="h-svc">Services</h2>' +
      '<span class="aside">Uptime over the past 90 days</span></div>';
    v.sections.forEach(function (s) { html += renderGroup(s.title, s.state, s.services, s.id); });
    if (v.unsectioned && v.unsectioned.length) html += renderGroup("Other services", worstState(v.unsectioned), v.unsectioned, "other");
    html += renderLegend() + "</section>";

    html += renderHistory(v);
    html += "</main>";

    var links = (v.links || []).map(function (l) { return '<li><a href="' + esc(l.href) + '">' + esc(l.label) + "</a></li>"; }).join("");
    html += '<footer class="site-footer"><ul>' + links +
      (host ? "<li>" + esc(host) + "</li>" : "") + "</ul>" +
      '<span class="powered">Powered by <strong>Uptellis</strong></span></footer>';

    document.getElementById("app").innerHTML = html;
    document.title = v.verdict.label + " | " + name + " status";
  }

  function pick() {
    var h = (location.hash || "").replace(/^#/, "");
    return STATES.indexOf(h) >= 0 ? h : "healthy";
  }

  function draw() {
    var data = window.UPTELLIS_DEMO;
    if (!data) return;
    render(data[pick()]);
  }

  window.addEventListener("hashchange", draw);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", draw);
  else draw();
})();
