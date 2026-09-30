/* Friendly mock-up: renders window.UPTELLIS_DEMO[state] (state from the URL hash) in plain, warm language. */
(function () {
  "use strict";

  var DEMO = window.UPTELLIS_DEMO || {};
  var STATES = ["healthy", "incident", "stale"];
  var loadedAt = Date.now();

  var WORD = {
    up: "Working", degraded: "A bit slow", pending: "Checking", down: "Not working",
    maintenance: "Planned work", paused: "Paused", unknown: "Not sure", stale: "No recent update"
  };
  var TONE = { up: "up", degraded: "warn", pending: "warn", down: "down", maintenance: "maint", paused: "idle", unknown: "idle", stale: "idle" };
  var KIND = { http: "Website check", keyword: "Website content check", port: "Connection check", ping: "Ping", push: "Check-in from the service", fact: "System report", tls: "Certificate check" };

  var PILL_ICON = {
    up: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".18"/><path d="M6 10.5l2.6 2.6L14 7.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".18"/><path d="M7 7l6 6M13 7l-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    warn: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".18"/><path d="M10 5.5v5.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="10" cy="14.2" r="1.3" fill="currentColor"/></svg>',
    maint: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".18"/><path d="M10 5.5V10l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    idle: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".18"/><circle cx="6.5" cy="10" r="1.3" fill="currentColor"/><circle cx="10" cy="10" r="1.3" fill="currentColor"/><circle cx="13.5" cy="10" r="1.3" fill="currentColor"/></svg>'
  };

  // Illustrations for the overall state: a soft round buddy whose face tells the story.
  function art(state) {
    var face, fill, cheek, extra = "";
    if (state === "operational") {
      fill = "#bff0d3"; cheek = "#ffb3c1";
      face = '<path d="M47 58q3-5 6 0M67 58q3-5 6 0" fill="none" stroke="#2f2a3b" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M50 72q10 10 20 0" fill="none" stroke="#2f2a3b" stroke-width="3.2" stroke-linecap="round"/>';
      extra = '<g fill="#ffd36e"><path d="M22 26l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z"/><path d="M98 18l1.8 4.2 4.2 1.8-4.2 1.8-1.8 4.2-1.8-4.2-4.2-1.8 4.2-1.8z"/><path d="M104 88l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z"/></g>';
    } else if (state === "outage" || state === "degraded") {
      fill = state === "outage" ? "#ffd1d6" : "#ffe2bd"; cheek = "#ff9aa8";
      face = '<circle cx="50" cy="58" r="3.2" fill="#2f2a3b"/><circle cx="70" cy="58" r="3.2" fill="#2f2a3b"/>' +
        '<path d="M44 49l10 3M76 49l-10 3" stroke="#2f2a3b" stroke-width="2.6" stroke-linecap="round"/>' +
        '<path d="M51 76q9-7 18 0" fill="none" stroke="#2f2a3b" stroke-width="3.2" stroke-linecap="round"/>';
      extra = '<g transform="translate(86 20) rotate(35)"><rect x="-6" y="-14" width="12" height="28" rx="6" fill="#f7c59f"/><circle cx="-2" cy="-3" r="1.2" fill="#c98f63"/><circle cx="2" cy="3" r="1.2" fill="#c98f63"/></g>' +
        '<path d="M88 78c4 4 4 9 0 12-4-3-4-8 0-12z" fill="#8fc7ff"/>';
    } else {
      fill = "#dcd7f0"; cheek = "#f4b8c9";
      face = '<path d="M45 59q5 4 10 0M65 59q5 4 10 0" fill="none" stroke="#2f2a3b" stroke-width="3" stroke-linecap="round"/>' +
        '<ellipse cx="60" cy="75" rx="4" ry="3" fill="#2f2a3b"/>';
      extra = '<g class="zz" fill="#7a6fb0" font-family="Nunito, sans-serif" font-weight="800"><text x="86" y="34" font-size="16">z</text><text x="98" y="22" font-size="11">z</text></g>';
    }
    return '<svg viewBox="0 0 120 120" role="img" aria-label="' + (state === "operational" ? "A happy face" : state === "stale" || state === "empty" ? "A sleepy face" : "A worried face") + '">' +
      '<ellipse cx="60" cy="108" rx="30" ry="5" fill="#2f2a3b" opacity=".08"/>' +
      '<g class="float"><circle cx="60" cy="64" r="38" fill="' + fill + '"/>' +
      '<circle cx="42" cy="68" r="5" fill="' + cheek + '" opacity=".7"/><circle cx="78" cy="68" r="5" fill="' + cheek + '" opacity=".7"/>' + face + "</g>" + extra + "</svg>";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function ago(s) {
    if (s == null) return "not yet";
    s = Math.max(0, Math.round(s));
    if (s < 60) return "just now";
    if (s < 3600) return plural(Math.floor(s / 60), "minute") + " ago";
    if (s < 86400) return plural(Math.floor(s / 3600), "hour") + " ago";
    return plural(Math.floor(s / 86400), "day") + " ago";
  }
  function duration(s) {
    s = Math.max(0, Math.round(s));
    if (s < 60) return "less than a minute";
    if (s < 3600) return plural(Math.round(s / 60), "minute");
    if (s < 86400) { var h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return plural(h, "hour") + (m ? " and " + plural(m, "minute") : ""); }
    return plural(Math.round(s / 86400), "day");
  }
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function clock(iso) { var t = new Date(iso); return ("0" + t.getUTCHours()).slice(-2) + ":" + ("0" + t.getUTCMinutes()).slice(-2) + " UTC"; }
  function niceDate(iso) { var t = new Date(iso); return t.getUTCDate() + " " + MONTHS[t.getUTCMonth()]; }
  function pct(r) { if (r == null) return "not measured yet"; var p = r * 100; return (p === 100 ? "100" : p >= 99.995 ? "99.99" : p.toFixed(2)) + "%"; }
  function every(s) { if (!s) return null; return s < 60 ? plural(s, "second") : plural(Math.round(s / 60), "minute"); }

  function pill(state, big) {
    var tone = TONE[state] || "idle";
    return '<span class="pill p-' + tone + (big ? " pill--big" : "") + '">' + PILL_ICON[tone] + esc(WORD[state] || state) + "</span>";
  }
  function verdictPill(v) {
    var tone = { operational: "up", degraded: "warn", outage: "down", stale: "idle", empty: "idle" }[v.verdict.state] || "idle";
    return '<span class="pill pill--big p-' + tone + '">' + PILL_ICON[tone] + esc(v.verdict.label) + "</span>";
  }
  function ageSpan(base) { return '<span data-age="' + (base == null ? "" : base) + '">' + esc(ago(base)) + "</span>"; }

  function pickState() {
    var h = (location.hash || "").replace("#", "");
    return STATES.indexOf(h) >= 0 ? h : "healthy";
  }
  function allServices(v) {
    var out = [];
    v.sections.forEach(function (s) { out = out.concat(s.services); });
    return out.concat(v.unsectioned || []);
  }

  function heroText(v, name) {
    var st = v.verdict.state, svcs = allServices(v);
    var down = svcs.filter(function (s) { return s.state === "down"; }).map(function (s) { return s.name; });
    var slow = svcs.filter(function (s) { return s.state === "degraded"; }).map(function (s) { return s.name; });
    var list = function (a) { return a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]; };
    if (st === "operational") return { h: "Everything is running smoothly", p: "All " + plural(v.summary.total, "part") + " of " + name + " are up and answering. Nothing for you to worry about." };
    if (st === "outage") return {
      h: down.length === 1 ? "One part of " + name + " isn't working right now" : "A few parts of " + name + " aren't working right now",
      p: list(down) + (down.length === 1 ? " is" : " are") + " having trouble" + (slow.length ? ", and " + list(slow) + " " + (slow.length === 1 ? "is" : "are") + " a bit slow" : "") +
        ". Everything else is working normally."
    };
    if (st === "degraded") return { h: "Some things are a little slow right now", p: list(slow) + (slow.length === 1 ? " is" : " are") + " working, but slower than usual. Everything else is fine." };
    if (st === "stale") return { h: "We haven't had an update in a while", p: "Our checks last reached us " + ago(v.freshness.ageS) + ", so we can't say for sure how things are right now. What you see below is how things looked back then." };
    return { h: "We're waiting for our first check-in", p: "As soon as our checks report in, you'll see how everything is doing here." };
  }

  function days(s) {
    var good = 0, known = 0;
    var cells = s.beats90d.map(function (b) {
      var tone = b.worst ? TONE[b.worst] || "idle" : "none";
      if (b.worst) { known++; if (b.worst === "up") good++; }
      var t = niceDate(b.day) + ": " + (b.worst ? (WORD[b.worst] || b.worst) : "no news") + (b.minutesDown ? " (down for " + b.minutesDown + " min)" : "");
      return '<i class="d-' + tone + '" title="' + esc(t) + '"></i>';
    }).join("");
    var cap = known ? plural(good, "smooth day") + " out of " + known : "No history yet";
    return '<div class="days" role="img" aria-label="Last 90 days: ' + esc(cap) + '">' + cells + '</div>' +
      '<div class="days-cap" aria-hidden="true"><span>90 days ago</span><span>' + esc(cap) + "</span><span>Today</span></div>";
  }

  function tech(s) {
    var rows = [];
    function row(k, val, mono) { if (val != null && val !== "") rows.push("<dt>" + esc(k) + "</dt><dd" + (mono ? ' class="mono"' : "") + ">" + esc(val) + "</dd>"); }
    row("Type of check", KIND[s.kind] || s.kind);
    row("Checks", s.targetDisplay, true);
    row("Method", s.method, true);
    row("Response time", s.latencyMs != null ? s.latencyMs + " ms" : "no answer", true);
    row("Usual response", s.avgLatencyMs != null ? Math.round(s.avgLatencyMs) + " ms" : null, true);
    row("Up, last 24 hours", pct(s.uptime24h));
    row("Up, last 30 days", pct(s.uptime30d));
    row("Checked every", every(s.intervalS));
    if (s.cert) row("Security certificate", s.cert.valid ? "Valid for " + plural(s.cert.daysRemaining, "more day") + " (" + s.cert.issuer + ")" : "Not valid");
    if (s.health && s.health.score != null) row("Health score", Math.round(s.health.score) + " of 100" + (s.health.reasons.length ? ": " + s.health.reasons.join(", ") : ""));
    if (s.state === "stale") row("Last reported", WORD[s.status] || s.status);
    return '<details class="tech"><summary>Technical details</summary><dl>' + rows.join("") + "</dl></details>";
  }

  function service(s) {
    return '<li class="svc' + (s.state === "stale" ? " is-stale" : "") + '"><div class="svc__row"><span class="svc__name">' + esc(s.name) + "</span>" + pill(s.state) + "</div>" + days(s) + tech(s) + "</li>";
  }

  function render() {
    var key = pickState();
    var v = DEMO[key];
    var app = document.getElementById("app");
    if (!v) { app.innerHTML = '<p class="loading">Nothing to show for this view.</p>'; return; }
    var f = v.freshness;
    var name = v.branding.title || v.site.name;
    document.title = v.verdict.label + " | " + name;
    var hero = heroText(v, name);
    var html = "";

    html += '<header class="top"><div class="brand"><span class="brand__mark" aria-hidden="true">' + esc(name.charAt(0)) + "</span><div>" +
      '<p class="brand__name">' + esc(name) + "</p>" +
      '<p class="brand__tag">' + esc(v.branding.tagline || (name !== v.site.name ? v.site.name : "Service status")) + "</p></div></div>" +
      '<nav aria-label="Preview state"><ul class="switch">' + STATES.map(function (s) {
        return '<li><a href="#' + s + '"' + (s === key ? ' aria-current="page"' : "") + ">" + s.charAt(0).toUpperCase() + s.slice(1) + "</a></li>";
      }).join("") + "</ul></nav></header>";

    html += '<main id="main">';
    html += '<section class="hero hero--' + esc(v.verdict.state) + '" aria-labelledby="h-hero"><div class="hero__art">' + art(v.verdict.state) + "</div><div>" +
      verdictPill(v) + '<h1 id="h-hero">' + esc(hero.h) + "</h1><p>" + esc(hero.p) + "</p>" +
      '<p class="updated">Last update received ' + ageSpan(f.ageS) + "</p></div></section>";

    if (f.state !== "fresh" && !f.quietForMaintenance) {
      var stale = f.state === "stale" || f.state === "empty";
      html += '<aside class="callout callout--stale" role="status">' + PILL_ICON.warn + "<div><h2>" +
        (stale ? "Heads up: this page may be out of date" : "Updates are running a little late") + "</h2><p>" +
        (f.state === "empty" ? "We haven't heard from our checks yet." : "The last update came in " + ageSpan(f.ageS) + ".") +
        (stale ? " Until fresh news arrives, every service shows “No recent update” instead of a green light." : " Things below may be a few minutes behind.") + "</p></div></aside>";
    }

    (v.maintenance || []).forEach(function (m) {
      var covered = m.services.length ? allServices(v).filter(function (s) { return m.services.indexOf(s.id) >= 0; }).map(function (s) { return s.name; }).join(", ") : "everything";
      html += '<aside class="callout callout--maint">' + PILL_ICON.maint + "<div><h2>Planned work: " + esc(m.title) + "</h2><p>" +
        "From " + esc(niceDate(m.start) + " at " + clock(m.start)) + " until " + esc(niceDate(m.end) + " at " + clock(m.end)) + ". This affects " + esc(covered) + ", so a short pause there is expected.</p></div></aside>";
    });

    if (v.incidents.open.length) {
      html += '<section class="block" aria-labelledby="h-now"><h2 id="h-now">What’s happening right now</h2><ul class="now-list">' +
        v.incidents.open.map(function (i) {
          var txt = i.kind === "stale"
            ? "We stopped hearing from " + i.subject + " " + duration(i.durationS) + " ago (at " + clock(i.startedAt) + ")."
            : i.subject + " stopped working " + duration(i.durationS) + " ago (at " + clock(i.startedAt) + "). It still isn't answering, and this page will change as soon as it's back.";
          return '<li class="now-card">' + pill("down") + "<h3>" + esc(i.title) + "</h3><p>" + esc(txt) + (i.notes ? " " + esc(i.notes) : "") + "</p></li>";
        }).join("") + "</ul></section>";
    }

    html += '<section class="block" aria-labelledby="h-svc"><h2 id="h-svc">How everything is doing<small>' + v.summary.up + " of " + v.summary.total + " working</small></h2><div class=\"groups\">";
    var groups = v.sections.map(function (s) { return { title: s.title, state: s.state, services: s.services }; });
    if (v.unsectioned && v.unsectioned.length) groups.push({ title: "Everything else", state: null, services: v.unsectioned });
    groups.forEach(function (g, gi) {
      html += '<section class="group" aria-labelledby="g-' + gi + '"><div class="group__head"><h3 id="g-' + gi + '">' + esc(g.title) + "</h3>" + (g.state ? pill(g.state) : "") + "</div>" +
        '<ul class="svc-list">' + g.services.map(service).join("") + "</ul></section>";
    });
    html += "</div></section>";

    html += '<section class="block" aria-labelledby="h-past"><h2 id="h-past">Earlier hiccups</h2>';
    html += v.incidents.recent.length ? '<ul class="past">' + v.incidents.recent.map(function (i) {
      var t = new Date(i.startedAt);
      var txt = i.kind === "stale"
        ? "We didn't hear from " + i.subject + " for " + duration(i.durationS) + ", from " + clock(i.startedAt) + (i.endedAt ? " to " + clock(i.endedAt) : "") + "."
        : i.subject + " wasn't working for " + duration(i.durationS) + ", from " + clock(i.startedAt) + (i.endedAt ? " to " + clock(i.endedAt) : "") + ".";
      return '<li><div class="past__date" aria-hidden="true"><b>' + t.getUTCDate() + "</b><span>" + MONTHS[t.getUTCMonth()].slice(0, 3) + "</span></div><div>" +
        pill(i.endedAt ? "up" : "down").replace(WORD.up, "Fixed") + "<p><strong>" + esc(niceDate(i.startedAt)) + ":</strong> " + esc(txt) + (i.notes ? " " + esc(i.notes) : "") + "</p></div></li>";
    }).join("") + "</ul>" : '<p class="calm">No hiccups lately. Everything has been calm.</p>';
    html += "</section></main>";

    html += '<footer class="foot">';
    if (v.links && v.links.length) html += '<nav aria-label="Helpful links"><ul>' + v.links.map(function (l) { return '<li><a href="' + esc(l.href) + '">' + esc(l.label) + "</a></li>"; }).join("") + "</ul></nav>";
    html += '<details class="tech" style="display:inline-block;text-align:left"><summary>Where our updates come from</summary><dl>' + f.perSource.map(function (s) {
      return "<dt>" + esc(s.id) + "</dt><dd>" + (s.ageS == null ? "hasn't reported yet" : "reported " + ageSpan(s.ageS)) + " (" + esc(s.freshness) + ")</dd>";
    }).join("") + "</dl></details>";
    html += "<p>" + esc(v.site.name) + " status page, made with Uptellis.</p></footer>";

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
