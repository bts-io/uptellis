/* Editorial mock-up: renders window.UPTELLIS_DEMO[state] (state from the URL hash) as a short article. */
(function () {
  "use strict";

  var DEMO = window.UPTELLIS_DEMO || {};
  var STATES = ["healthy", "incident", "stale"];
  var loadedAt = Date.now();

  var STATE_WORD = {
    up: "Operational", degraded: "Degraded", down: "Down", maintenance: "Maintenance",
    pending: "Pending", paused: "Paused", unknown: "Unknown", stale: "Stale"
  };
  var KICKER = { operational: "Operating normally", degraded: "Service degraded", outage: "Service disruption", stale: "Report out of date", empty: "Awaiting first report" };

  // Small inline glyphs so state never relies on colour alone.
  var ICON = {
    up: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    degraded: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2l6.5 12h-13z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M8 6.5v3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    maintenance: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    other: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="3 2.4"/></svg>'
  };
  ICON.pending = ICON.degraded;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function ago(s) {
    if (s == null) return "never";
    s = Math.max(0, Math.round(s));
    if (s < 60) return plural(s, "second") + " ago";
    if (s < 3600) return plural(Math.floor(s / 60), "minute") + " ago";
    if (s < 86400) return plural(Math.floor(s / 3600), "hour") + " ago";
    return plural(Math.floor(s / 86400), "day") + " ago";
  }
  function duration(s) {
    s = Math.max(0, Math.round(s));
    if (s < 60) return plural(s, "second");
    if (s < 3600) return plural(Math.round(s / 60), "minute");
    var h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
    if (s < 86400) return plural(h, "hour") + (m ? " " + plural(m, "minute") : "");
    return plural(Math.floor(s / 86400), "day") + (h % 24 ? " " + plural(h % 24, "hour") : "");
  }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function d(iso) { return new Date(iso); }
  function longDate(iso) { var t = d(iso); return t.getUTCDate() + " " + MONTHS[t.getUTCMonth()] + " " + t.getUTCFullYear(); }
  function shortDate(iso) { var t = d(iso); return t.getUTCDate() + " " + MONTHS[t.getUTCMonth()].slice(0, 3); }
  function clock(iso) { var t = d(iso); return ("0" + t.getUTCHours()).slice(-2) + ":" + ("0" + t.getUTCMinutes()).slice(-2) + " UTC"; }
  function pct(r) {
    if (r == null) return "n/a";
    var p = r * 100;
    return (p === 100 ? "100" : p >= 99.995 ? "99.99" : p.toFixed(2)) + "%";
  }
  function stateTag(state, extra) {
    var icon = ICON[state] || ICON.other;
    return '<span class="state s-' + esc(state) + '">' + icon + esc(STATE_WORD[state] || state) + (extra || "") + "</span>";
  }
  function ageSpan(base) {
    return '<span data-age="' + (base == null ? "" : base) + '">' + esc(ago(base)) + "</span>";
  }

  function pickState() {
    var h = (location.hash || "").replace("#", "");
    return STATES.indexOf(h) >= 0 ? h : "healthy";
  }

  function allServices(v) {
    var out = [];
    v.sections.forEach(function (s) { out = out.concat(s.services); });
    return out.concat(v.unsectioned || []);
  }

  function standfirst(v) {
    var svcs = allServices(v), total = v.summary.total, sections = v.sections.length;
    var f = v.freshness;
    if (v.verdict.state === "stale") {
      return "Our monitors last reported " + ago(f.ageS) + ". Until they check in again, read everything below as the last known picture of " +
        plural(total, "service") + ", not as the current one.";
    }
    if (v.verdict.state === "empty") return "No monitor has reported yet, so there is nothing to say about the " + plural(total, "service") + " on this page.";
    var bad = svcs.filter(function (s) { return s.state === "down" || s.state === "degraded"; });
    if (bad.length) {
      var parts = bad.map(function (s) {
        var inc = (v.incidents.open || []).filter(function (i) { return i.id === s.openIncidentId; })[0];
        return s.name + " is " + (s.state === "down" ? "down" : "degraded") + (inc ? ", for " + duration(inc.durationS) + " so far" : "");
      });
      var ok = total - bad.length;
      return parts.join("; ") + ". " + (ok === 1 ? "The one other service is" : "The other " + ok + " services are") + " answering normally.";
    }
    var lat = v.summary.avgLatencyMs != null ? " in " + Math.round(v.summary.avgLatencyMs) + " ms on average" : "";
    return "All " + plural(total, "service") + " across " + plural(sections, "section") + " answered their latest checks" + lat +
      (v.summary.uptime30d != null ? ", with " + pct(v.summary.uptime30d) + " uptime over the past 30 days." : ".");
  }

  function bar(s) {
    var up = 0, bad = 0, none = 0;
    var ticks = s.beats90d.map(function (b) {
      if (b.worst === "up") up++; else if (b.worst == null) none++; else bad++;
      var t = b.day + ": " + (b.worst ? STATE_WORD[b.worst] || b.worst : "no data") + (b.minutesDown ? ", " + b.minutesDown + " min down" : "");
      return '<i class="t-' + (b.worst || "none") + '" title="' + esc(t) + '"></i>';
    }).join("");
    var label = "90 days: " + up + " clear, " + bad + " with problems" + (none ? ", " + none + " without data" : "");
    return '<div class="bar-wrap"><div class="bar" role="img" aria-label="' + esc(label) + '">' + ticks + '</div>' +
      '<div class="bar-scale" aria-hidden="true"><span>90 days ago</span><span>today</span></div></div>';
  }

  function serviceRow(s) {
    var detail = [s.targetDisplay, s.latencyMs != null ? '<span class="mono">' + s.latencyMs + " ms</span>" : null].filter(Boolean);
    var extra = s.state === "stale" ? " <small>(last seen " + esc((STATE_WORD[s.status] || s.status).toLowerCase()) + ")</small>" : "";
    return '<li class="svc' + (s.state === "stale" ? " is-stale" : "") + '">' +
      '<div class="svc__name">' + esc(s.name) + (detail.length ? "<small>" + detail.map(function (x, i) { return i === 0 && s.targetDisplay ? esc(x) : x; }).join(" &middot; ") + "</small>" : "") + "</div>" +
      bar(s) +
      '<div class="svc__up">' + pct(s.uptime30d) + "<small>30 days</small></div>" +
      stateTag(s.state, extra) +
      "</li>";
  }

  function newsItem(i, open) {
    var when = '<div class="news__when"><strong>' + esc(shortDate(i.startedAt)) + "</strong>" + esc(clock(i.startedAt)) + "</div>";
    var body;
    if (open) {
      body = (i.kind === "stale" ? "Reports from " + i.subject + " stopped arriving at " : i.subject + " stopped answering at ") +
        clock(i.startedAt) + " and has been out for " + duration(i.durationS) + ". It is still open.";
    } else {
      body = (i.kind === "stale" ? "Reports from " + i.subject + " went quiet at " : i.subject + " went down at ") + clock(i.startedAt) +
        (i.endedAt ? " and was back at " + clock(i.endedAt) + ", after " + duration(i.durationS) + "." : ".");
    }
    var steps = i.steps && i.steps.length > 2 ? " Timeline: " + i.steps.map(function (s) { return s.label + " " + clock(s.ts); }).join(", ") + "." : "";
    return "<li>" + when + "<div><h3>" +
      '<span class="news__tag' + (open ? "" : " news__tag--ok") + '">' + (open ? "Ongoing" : "Resolved") + "</span>" + esc(i.title) + "</h3>" +
      "<p>" + esc(body + steps) + (i.notes ? " " + esc(i.notes) : "") + "</p></div></li>";
  }

  function render() {
    var key = pickState();
    var v = DEMO[key];
    var app = document.getElementById("app");
    if (!v) { app.innerHTML = '<p class="loading">No data for this state.</p>'; return; }
    var f = v.freshness;
    var name = v.branding.title || v.site.name;
    document.title = v.verdict.label + " | " + name;

    var html = "";
    html += '<header class="masthead"><p class="masthead__name">' + esc(name) + "</p>" +
      '<span class="masthead__meta">Status report &middot; ' + esc(v.site.hostnames[0] || v.site.slug) + "</span>" +
      (v.branding.tagline ? '<p class="masthead__tagline">' + esc(v.branding.tagline) + "</p>" : "") + "</header>";
    if (name !== v.site.name) html += '<p class="masthead__meta">' + esc(v.site.name) + "</p>";

    html += '<nav class="editions" aria-label="Preview state"><span>Preview:</span><ul>' + STATES.map(function (s) {
      return '<li><a href="#' + s + '"' + (s === key ? ' aria-current="page"' : "") + ">" + s.charAt(0).toUpperCase() + s.slice(1) + "</a></li>";
    }).join("") + "</ul></nav>";

    html += '<main id="story">';
    html += '<article class="lead state-' + esc(v.verdict.state) + '">' +
      '<p class="kicker">' + esc(KICKER[v.verdict.state] || v.verdict.state) + "</p>" +
      "<h1>" + esc(v.verdict.label) + ".</h1>" +
      '<p class="standfirst">' + esc(standfirst(v)) + "</p>" +
      '<p class="dateline"><span><strong>' + esc(longDate(v.generatedAt)) + "</strong>, " + esc(clock(v.generatedAt)) + "</span>" +
      "<span>Updated " + ageSpan(f.ageS) + "</span>" +
      "<span>" + plural(v.summary.total, "service") + " watched</span></p>" +
      (v.headline ? '<p class="note">' + esc(v.headline) + ".</p>" : "") + "</article>";

    if (f.state !== "fresh" && !f.quietForMaintenance) {
      var stale = f.state === "stale" || f.state === "empty";
      html += '<aside class="notice notice--stale" role="status"><h2>' + (stale ? "This report is out of date" : "Reports are running late") + "</h2>" +
        "<p>The " + (f.state === "empty" ? "monitors have not reported yet" : "stalest source" + (f.stalestSourceId ? " (" + esc(f.stalestSourceId) + ")" : "") + " last reported " + ageSpan(f.ageS)) +
        ". " + (stale ? "Every state below is the last one we heard, shown as Stale until fresh data arrives." : "The picture below may lag slightly.") + "</p></aside>";
    }

    (v.maintenance || []).forEach(function (m) {
      var covered = m.services.length ? allServices(v).filter(function (s) { return m.services.indexOf(s.id) >= 0; }).map(function (s) { return s.name; }).join(", ") : "every service";
      html += '<aside class="notice notice--maint"><h2>Planned maintenance</h2><p><strong>' + esc(m.title) + ".</strong> From " +
        esc(shortDate(m.start) + ", " + clock(m.start)) + " to " + esc(shortDate(m.end) + ", " + clock(m.end)) + ", covering " + esc(covered) + ".</p></aside>";
    });

    if (v.incidents.open.length) {
      html += '<section class="part" aria-labelledby="h-open"><h2 id="h-open">Developing <span>' + plural(v.incidents.open.length, "open incident") + "</span></h2>" +
        '<ul class="news news--open">' + v.incidents.open.map(function (i) { return newsItem(i, true); }).join("") + "</ul></section>";
    }

    html += '<section class="part" aria-labelledby="h-svc"><h2 id="h-svc">The services <span>' + v.summary.up + " of " + v.summary.total + " operational</span></h2>";
    var groups = v.sections.map(function (s) { return { title: s.title, state: s.state, services: s.services }; });
    if (v.unsectioned && v.unsectioned.length) groups.push({ title: "Other", state: null, services: v.unsectioned });
    groups.forEach(function (g, gi) {
      html += '<div class="desk"><h3 id="desk-' + gi + '">' + esc(g.title) + (g.state ? stateTag(g.state) : "") + "</h3>" +
        '<ul class="services" aria-labelledby="desk-' + gi + '">' + g.services.map(serviceRow).join("") + "</ul></div>";
    });
    html += "</section>";

    html += '<section class="part" aria-labelledby="h-past"><h2 id="h-past">From the log <span>recent incidents</span></h2>';
    html += v.incidents.recent.length
      ? '<ul class="news">' + v.incidents.recent.map(function (i) { return newsItem(i, false); }).join("") + "</ul>"
      : '<p class="empty-note">Nothing to report. No incidents in the recent record.</p>';
    html += "</section></main>";

    html += '<footer class="colophon">';
    if (v.links && v.links.length) {
      html += '<h2>Elsewhere</h2><ul class="links">' + v.links.map(function (l) { return '<li><a href="' + esc(l.href) + '">' + esc(l.label) + "</a></li>"; }).join("") + "</ul>";
    }
    html += "<h2>Sources</h2><ul>" + f.perSource.map(function (s) {
      var cls = s.freshness === "stale" ? ' class="src-stale"' : "";
      return "<li" + cls + ">" + esc(s.id) + ": " + (s.ageS == null ? "has not reported" : "reported " + ageSpan(s.ageS)) + " (" + esc(s.freshness) + ")</li>";
    }).join("") + "</ul>";
    html += '<h2>How to read the bars</h2><ul class="legend">' +
      '<li><i style="background:var(--tick-up)"></i>No problems</li><li><i style="background:var(--tick-degraded)"></i>Degraded</li>' +
      '<li><i style="background:var(--tick-down)"></i>Outage</li><li><i style="background:var(--tick-maintenance)"></i>Maintenance</li>' +
      '<li><i style="background:var(--tick-none)"></i>No data</li></ul>';
    html += "<p>" + esc(v.site.name) + " status, published with Uptellis.</p></footer>";

    app.innerHTML = html;
  }

  function tick() {
    var elapsed = Math.floor((Date.now() - loadedAt) / 1000);
    var els = document.querySelectorAll("[data-age]");
    for (var i = 0; i < els.length; i++) {
      var base = els[i].getAttribute("data-age");
      if (base !== "") els[i].textContent = ago(Number(base) + elapsed);
    }
  }

  render();
  window.addEventListener("hashchange", function () { loadedAt = Date.now(); render(); window.scrollTo(0, 0); });
  setInterval(tick, 15000);
})();
