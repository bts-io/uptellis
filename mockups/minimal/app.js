/* Minimal / one-line mock-up: renders window.UPTELLIS_DEMO[state] (a SiteView) picked by the URL hash. */
(function () {
  "use strict";

  var STATES = ["healthy", "incident", "stale"];
  var WORD = {
    up: "Operational", degraded: "Degraded", down: "Down", pending: "Pending",
    maintenance: "Maintenance", paused: "Paused", unknown: "Unknown", stale: "No recent data",
  };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function shortDay(iso) { var t = new Date(iso); return MONTHS[t.getUTCMonth()] + " " + t.getUTCDate(); }
  function hhmm(iso) { var t = new Date(iso); return pad(t.getUTCHours()) + ":" + pad(t.getUTCMinutes()) + " UTC"; }
  function dur(s) {
    if (s == null) return "";
    if (s < 60) return Math.max(1, Math.round(s)) + "s";
    var m = Math.round(s / 60);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60), rm = m % 60;
    if (h < 24) return h + "h" + (rm ? " " + rm + "m" : "");
    return Math.floor(h / 24) + "d " + (h % 24) + "h";
  }
  function ago(s) { return s == null ? "never" : s < 60 ? "just now" : dur(s) + " ago"; }
  function pct(r) { return r == null ? null : (r >= 0.99995 ? "100" : (r * 100).toFixed(2)) + "%"; }

  function state(s) {
    return '<span class="state" data-s="' + esc(s) + '"><i aria-hidden="true"></i>' + esc(WORD[s] || s) + "</span>";
  }

  function strip(svc) {
    var days = svc.beats90d || [];
    var sum = 0, n = 0;
    var cells = days.map(function (b) {
      if (b.uptime != null) { sum += b.uptime; n++; }
      var tip = shortDay(b.day + "T00:00:00Z") + ": " + (b.worst ? (WORD[b.worst] || b.worst) + (b.uptime != null ? ", " + pct(b.uptime) : "") : "no data");
      return '<span data-w="' + esc(b.worst || "none") + '" title="' + esc(tip) + '"></span>';
    }).join("");
    var label = svc.name + ", last 90 days: " + (n ? pct(sum / n) + " uptime" : "no data");
    return '<span class="strip" role="img" aria-label="' + esc(label) + '" data-beats="' + esc(svc.beatsText) + '">' + cells + "</span>";
  }

  function row(svc) {
    return '<li class="svc"><span class="svc-name" title="' + esc(svc.name) + '">' + esc(svc.name) + "</span>" + strip(svc) + state(svc.state) + "</li>";
  }

  function group(title, services) {
    if (!services.length) return "";
    return '<section class="group" aria-label="' + esc(title) + '"><h3 class="label">' + esc(title) + '</h3><ul class="svc-list">' +
      services.map(row).join("") + "</ul></section>";
  }

  function verdictNote(v) {
    var st = v.verdict.state, f = v.freshness;
    if (st === "stale" || st === "empty") return "";
    if (st === "operational") return v.summary.total + " services, updated " + ago(f.ageS);
    var bits = [];
    if (v.verdict.down) bits.push(v.verdict.down + " down");
    if (v.verdict.degraded) bits.push(v.verdict.degraded + " degraded");
    return bits.join(", ") + " of " + v.summary.total + ", updated " + ago(f.ageS);
  }

  function freshNote(v) {
    var f = v.freshness;
    if (!f || f.state === "fresh" || f.quietForMaintenance) return "";
    var src = f.perSource.filter(function (s) { return s.id === f.stalestSourceId; })[0];
    var at = src && src.lastSeenAt ? " (" + shortDay(src.lastSeenAt) + ", " + hhmm(src.lastSeenAt) + ")" : "";
    if (f.state === "stale") {
      return '<p class="note is-stale" role="alert"><strong>Last data ' + esc(ago(f.ageS)) + ".</strong> " +
        "Monitoring has not reported since" + esc(at) + ". Statuses below are the last known and may have changed.</p>";
    }
    if (f.state === "aging") {
      return '<p class="note is-stale"><strong>Updates delayed.</strong> Newest data is ' + esc(dur(f.ageS)) + " old" + esc(at) + ".</p>";
    }
    return '<p class="note is-stale" role="alert"><strong>No data yet.</strong> Waiting for monitoring to report.</p>';
  }

  function maintNote(v) {
    var names = {};
    v.sections.forEach(function (s) { s.services.forEach(function (x) { names[x.id] = x.name; }); });
    (v.unsectioned || []).forEach(function (x) { names[x.id] = x.name; });
    return (v.maintenance || []).map(function (m) {
      var scope = m.services.length ? m.services.map(function (id) { return names[id] || id; }).join(", ") : "all services";
      return '<p class="note is-maint"><strong>Maintenance:</strong> ' + esc(m.title) + ", " + esc(scope) + ", until " +
        esc(shortDay(m.end)) + " " + esc(hhmm(m.end)) + ".</p>";
    }).join("");
  }

  function openList(v) {
    var open = v.incidents.open || [];
    if (!open.length) return "";
    return '<section class="block" aria-labelledby="h-open"><h2 class="label" id="h-open">Ongoing</h2><ul class="open">' +
      open.map(function (i) {
        var last = (i.steps || [])[i.steps.length - 1];
        return '<li><div class="t">' + esc(i.title) + "</div><p>Since " + esc(hhmm(i.startedAt)) + ", " + esc(dur(i.durationS)) +
          (last ? ". " + esc(last.label) : "") + (i.notes ? ". " + esc(i.notes) : "") + "</p></li>";
      }).join("") + "</ul></section>";
  }

  function pastList(v) {
    var recent = v.incidents.recent || [];
    var body = recent.length
      ? '<ul class="past">' + recent.map(function (i) {
          return '<li><time datetime="' + esc(i.startedAt) + '">' + esc(shortDay(i.startedAt)) + "</time><span>" +
            '<span class="inc">' + esc(i.title) + '</span> <span class="dur">' + (i.endedAt ? esc(dur(i.durationS)) : "ongoing") + "</span></span></li>";
        }).join("") + "</ul>"
      : '<p class="none">No recent incidents.</p>';
    return '<section class="block" aria-labelledby="h-past"><h2 class="label" id="h-past">Past incidents</h2>' + body + "</section>";
  }

  function render(v) {
    var name = v.branding.title || v.site.name;
    var html = "";
    html += '<header class="top"><h1>' + esc(name) + (name !== v.site.name ? " " + esc(v.site.name) : "") + "</h1>" +
      '<span><time datetime="' + esc(v.generatedAt) + '">' + esc(shortDay(v.generatedAt)) + ", " + esc(hhmm(v.generatedAt)) + "</time></span></header>";
    html += "<main>";
    html += '<section aria-label="Overall status" role="status"><p class="verdict"><span class="dot" data-v="' + esc(v.verdict.state) + '" aria-hidden="true"></span>' +
      esc(v.verdict.label) + "</p>";
    var vn = verdictNote(v);
    if (vn) html += '<p class="verdict-note">' + esc(vn) + "</p>";
    if (v.branding.tagline) html += '<p class="verdict-note">' + esc(v.branding.tagline) + "</p>";
    html += "</section>";
    html += freshNote(v) + maintNote(v);
    html += openList(v);

    html += '<section class="block" aria-labelledby="h-svc"><h2 class="sr-only" id="h-svc">Services</h2>';
    v.sections.forEach(function (s) { html += group(s.title, s.services); });
    if (v.unsectioned && v.unsectioned.length) html += group("Other", v.unsectioned);
    html += '<div class="strip-key" aria-hidden="true"><span>90 days ago</span><span>today</span></div></section>';

    html += pastList(v);
    html += "</main>";

    var links = (v.links || []).map(function (l) { return '<li><a href="' + esc(l.href) + '">' + esc(l.label) + "</a></li>"; }).join("");
    var host = (v.site.hostnames || [])[0];
    html += "<footer><ul>" + links + (host ? "<li>" + esc(host) + "</li>" : "") + "</ul><span>Uptellis</span></footer>";

    document.getElementById("app").innerHTML = html;
    document.title = v.verdict.label + " | " + name;
  }

  function draw() {
    var data = window.UPTELLIS_DEMO;
    if (!data) return;
    var h = (location.hash || "").replace(/^#/, "");
    render(data[STATES.indexOf(h) >= 0 ? h : "healthy"]);
  }

  window.addEventListener("hashchange", draw);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", draw);
  else draw();
})();
