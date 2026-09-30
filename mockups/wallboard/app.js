/* Wallboard theme mock-up: renders window.UPTELLIS_DEMO[state] (state from the URL hash) and rotates
 * service sections when they do not all fit on one screen. Everything comes from the SiteView. */
(function () {
  "use strict";

  var PAGE_MS = 10000;
  var ICONS = {
    up: '<path d="M6 16.5l6.5 6.5L26 9.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
    down: '<path d="M8 8l16 16M24 8L8 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
    degraded: '<path d="M16 4L30 28H2z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M16 12v7" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><circle cx="16" cy="23.5" r="2" fill="currentColor"/>',
    maintenance: '<path d="M20 4a7 7 0 0 0-6.6 9.3L4 22.7 9.3 28l9.4-9.4A7 7 0 0 0 28 12l-4 4-5-1-1-5 4-4z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/>',
    stale: '<circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 9v7l5 3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
    unknown: '<circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="3"/><path d="M12.5 12.5a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3v.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="23" r="1.8" fill="currentColor"/>',
  };
  var ICON_FOR = { up: "up", down: "down", degraded: "degraded", pending: "degraded", maintenance: "maintenance", stale: "stale", paused: "unknown", unknown: "unknown" };
  var VERDICT_ICON = { operational: "up", degraded: "degraded", outage: "down", stale: "stale", empty: "unknown" };
  var WORD = { up: "Up", down: "Down", degraded: "Slow", pending: "Pending", maintenance: "Maint", stale: "Stale", paused: "Paused", unknown: "Unknown" };
  var TICK = { up: "#34e08a", degraded: "#ffc233", pending: "#ffc233", down: "#ff4b55", maintenance: "#6fb6ff", paused: "#9aa4b2", unknown: "#9aa4b2" };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var data = window.UPTELLIS_DEMO || {};
  var stateName = (location.hash || "").replace("#", "") || "healthy";
  if (!data[stateName]) stateName = "healthy";
  var view = data[stateName];
  var loadedAt = Date.now();
  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function icon(name) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 32 32");
    s.setAttribute("aria-hidden", "true");
    s.innerHTML = ICONS[name] || ICONS.unknown;
    return s;
  }
  function elapsedS() { return Math.floor((Date.now() - loadedAt) / 1000); }
  function ago(s) {
    if (s == null) return "never";
    if (s < 60) return s + " s";
    if (s < 3600) return Math.round(s / 60) + " min";
    if (s < 172800) return Math.round(s / 3600) + " h";
    return Math.round(s / 86400) + " days";
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function clock(iso) { var d = new Date(iso); return pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + " UTC"; }
  function day(iso) { var d = new Date(iso); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()]; }
  function pct(r) { return r == null ? null : (Math.floor(r * 10000) / 100).toFixed(2) + "%"; }
  function ms(v) { return v == null ? null : (v < 10 ? v.toFixed(0) : Math.round(v)) + " ms"; }

  var allServices = [];
  (view.sections || []).forEach(function (s) { allServices = allServices.concat(s.services); });
  allServices = allServices.concat(view.unsectioned || []);
  var nameById = {};
  allServices.forEach(function (s) { nameById[s.id] = s.name; });

  /* Header and branding */
  function renderHeader() {
    document.title = view.branding.title + " status";
    $("site-name").textContent = view.site.name;
    var host = (view.site.hostnames || [])[0];
    $("site-host").textContent = view.branding.tagline || host || "";
  }

  function renderFresh() {
    var f = view.freshness;
    var node = $("fresh");
    node.textContent = "";
    var dot = el("span", "dot");
    dot.setAttribute("aria-hidden", "true");
    node.appendChild(dot);
    var age = f.ageS == null ? null : f.ageS + elapsedS();
    var fresh = f.state === "fresh" || f.quietForMaintenance;
    node.classList.toggle("is-stale", !fresh);
    if (f.state === "empty") node.appendChild(document.createTextNode("No data received yet"));
    else if (fresh) node.appendChild(document.createTextNode("Updated " + ago(age) + " ago"));
    else node.appendChild(document.createTextNode("Stale: last data " + ago(age) + " ago"));
  }

  /* Verdict */
  function renderVerdict() {
    var v = view.verdict, s = view.summary;
    var box = $("verdict");
    box.setAttribute("data-state", v.state);
    var ic = $("verdict-icon");
    ic.textContent = "";
    ic.appendChild(icon(VERDICT_ICON[v.state] || "unknown"));
    $("verdict-label").textContent = v.label;
    var parts = [];
    if (v.state === "stale") parts.push(s.total + " services, states below are last known");
    else {
      parts.push(s.up + " of " + s.total + " up");
      if (s.down) parts.push(s.down + " down");
      if (s.degraded) parts.push(s.degraded + " slow");
      if (s.maintenance) parts.push(s.maintenance + " in maintenance");
    }
    if (s.uptime30d != null) parts.push(pct(s.uptime30d) + " uptime 30 days");
    $("verdict-counts").textContent = parts.join("  ·  ");
  }

  /* Alerts: open incidents first, then the stale notice, then maintenance */
  function alert(kind, iconName, tag, title, meta) {
    var li = el("div", "alert " + kind);
    li.setAttribute("role", kind === "maint" ? "status" : "alert");
    li.appendChild(icon(iconName));
    li.appendChild(el("span", "alert-tag", tag));
    li.appendChild(el("span", "alert-title", title));
    if (meta) li.appendChild(el("span", "alert-meta", meta));
    return li;
  }
  function renderAlerts() {
    var box = $("alerts");
    box.textContent = "";
    (view.incidents.open || []).forEach(function (i) {
      box.appendChild(alert("incident", "down", "Open incident", i.title,
        i.subject + "  ·  for " + ago(i.durationS + elapsedS()) + "  ·  since " + clock(i.startedAt)));
    });
    var f = view.freshness;
    if (f.state !== "fresh" && !f.quietForMaintenance) {
      var stale = (f.perSource || []).filter(function (p) { return p.freshness !== "fresh"; }).map(function (p) { return p.id; });
      var age = f.ageS == null ? null : f.ageS + elapsedS();
      box.appendChild(alert("stale", "stale", f.state === "empty" ? "No data" : "Stale data",
        f.state === "empty" ? "No source has reported yet" : "Data is " + ago(age) + " old",
        (stale.length ? "Not reporting: " + stale.join(", ") + "  ·  " : "") + "last snapshot " + clock(view.generatedAt)));
    }
    (view.maintenance || []).forEach(function (m) {
      var who = m.services && m.services.length ? m.services.map(function (id) { return nameById[id] || id; }).join(", ") : "All services";
      box.appendChild(alert("maint", "maintenance", "Maintenance", m.title, who + "  ·  until " + clock(m.end)));
    });
  }

  /* 90-day strip as inline SVG */
  function beats(svc) {
    var ns = "http://www.w3.org/2000/svg";
    var s = document.createElementNS(ns, "svg");
    s.setAttribute("class", "beats");
    s.setAttribute("viewBox", "0 0 90 10");
    s.setAttribute("preserveAspectRatio", "none");
    s.setAttribute("role", "img");
    var cells = svc.beats90d || [];
    var bad = cells.filter(function (c) { return c.worst && c.worst !== "up"; }).length;
    var none = cells.filter(function (c) { return !c.worst; }).length;
    s.setAttribute("aria-label", "90 days: " + (cells.length - bad - none) + " good, " + bad + " with issues" + (none ? ", " + none + " without data" : ""));
    var html = "";
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var fill = c.worst ? TICK[c.worst] || TICK.unknown : "#262c36";
      var h = c.worst && c.worst !== "up" ? 10 : 7;
      html += '<rect x="' + (i + 0.12) + '" y="' + (10 - h) + '" width="0.76" height="' + h + '" fill="' + fill + '"/>';
    }
    s.innerHTML = html;
    return s;
  }

  function tile(svc) {
    var li = el("li", "tile");
    li.setAttribute("data-state", svc.state);
    var row = el("div", "tile-row");
    row.appendChild(el("h3", "tile-name", svc.name));
    var st = el("span", "tile-state");
    st.appendChild(icon(ICON_FOR[svc.state] || "unknown"));
    st.appendChild(document.createTextNode(WORD[svc.state] || svc.state));
    row.appendChild(st);
    li.appendChild(row);

    var nums = el("p", "tile-nums");
    function num(val, label) {
      var span = el("span");
      var b = el("b", null, val);
      span.appendChild(b);
      span.appendChild(document.createTextNode(" " + label));
      nums.appendChild(span);
    }
    if (svc.state === "down") num("No response", "");
    else if (svc.latencyMs != null) num(ms(svc.latencyMs), "");
    if (svc.uptime30d != null) num(pct(svc.uptime30d), "30 d");
    num("90", "days");
    li.appendChild(nums);
    li.appendChild(beats(svc));
    return li;
  }

  /* Sections as tile groups */
  var groups = [];
  function renderSections() {
    var grid = $("grid");
    grid.textContent = "";
    groups = [];
    var sections = (view.sections || []).slice();
    if (view.unsectioned && view.unsectioned.length) {
      sections.push({ id: "_other", title: "Other", state: worstOf(view.unsectioned), services: view.unsectioned });
    }
    sections.forEach(function (sec) {
      var g = el("section", "group");
      g.setAttribute("aria-label", sec.title);
      var n = Math.max(1, sec.services.length);
      var span = Math.min(n, 4);
      g.style.gridColumn = "span " + span;
      g.style.setProperty("--cols", String(span));
      var head = el("div", "group-head");
      head.appendChild(el("h2", "group-title", sec.title));
      var gs = el("span", "group-state st-" + sec.state, sec.state === "up" ? "All up" : WORD[sec.state] || sec.state);
      head.appendChild(gs);
      g.appendChild(head);
      var list = el("ul", "tiles");
      sec.services.forEach(function (svc) { list.appendChild(tile(svc)); });
      g.appendChild(list);
      g._rank = RANK[sec.state] || 0;
      grid.appendChild(g);
      groups.push(g);
    });
  }
  var RANK = { down: 5, degraded: 4, pending: 4, stale: 3, maintenance: 2, unknown: 1, paused: 1, up: 0 };
  function worstOf(list) {
    return list.reduce(function (w, s) { return (RANK[s.state] || 0) > (RANK[w] || 0) ? s.state : w; }, "up");
  }

  /* Recent incidents (resolved) */
  function renderHistory() {
    var ol = $("history");
    ol.textContent = "";
    var recent = (view.incidents.recent || []).slice(0, 4);
    if (!recent.length) {
      ol.appendChild(el("li", "none", "No incidents in the recent history."));
      return;
    }
    recent.forEach(function (i) {
      var li = el("li");
      var badge = el("span", "h-badge " + (i.endedAt ? "st-up" : "st-down"), i.endedAt ? "Resolved" : "Open");
      li.appendChild(badge);
      li.appendChild(el("span", "h-title", i.title));
      li.appendChild(el("span", "h-meta", day(i.startedAt) + ", " + clock(i.startedAt) + "  ·  lasted " + ago(i.durationS)));
      ol.appendChild(li);
    });
  }

  function renderFoot() {
    var s = view.summary;
    var bits = [];
    if (view.headline) bits.push(view.headline);
    if (s.avgLatencyMs != null) bits.push("avg latency " + ms(s.avgLatencyMs));
    if (s.healthScore != null) bits.push("health " + Math.round(s.healthScore) + "/100");
    $("summary").textContent = bits.join("  ·  ");
    var ul = $("links");
    ul.textContent = "";
    (view.links || []).forEach(function (l) {
      var li = el("li");
      var a = el("a", null, l.label);
      a.href = l.href;
      li.appendChild(a);
      ul.appendChild(li);
    });
  }

  /* Rotation: split groups into pages that fit the grid; start on the page with the worst section. */
  var pages = [], pageIdx = 0, timer = null;
  function overflows(grid) { return grid.scrollHeight > grid.clientHeight + 2; }
  function showOnly(set) { groups.forEach(function (g) { g.hidden = set.indexOf(g) < 0; }); }
  function paginate() {
    var grid = $("grid");
    showOnly(groups);
    pages = [groups.slice()];
    var wall = window.innerWidth >= 900 && grid.clientHeight > 0;
    if (wall && overflows(grid)) {
      pages = [];
      var cur = [];
      groups.forEach(function (g) {
        cur.push(g);
        showOnly(cur);
        if (overflows(grid) && cur.length > 1) {
          cur.pop();
          pages.push(cur);
          cur = [g];
        }
      });
      if (cur.length) pages.push(cur);
    }
    pageIdx = 0;
    var best = -1;
    pages.forEach(function (p, i) {
      p.forEach(function (g) { if (g._rank > best) { best = g._rank; pageIdx = i; } });
    });
    showPage(pageIdx);
    schedule();
  }
  function showPage(i) {
    pageIdx = (i + pages.length) % pages.length;
    showOnly(pages[pageIdx]);
    var pager = $("pager");
    pager.hidden = pages.length < 2;
    if (pages.length < 2) return;
    var titles = pages[pageIdx].map(function (g) { return g.getAttribute("aria-label"); }).join(", ");
    $("pager-label").textContent = "Page " + (pageIdx + 1) + " of " + pages.length + ": " + titles;
    var fill = $("pager-fill");
    fill.classList.remove("run");
    void fill.offsetWidth;
    if (!reduceMotion) {
      fill.style.setProperty("--page-ms", PAGE_MS + "ms");
      fill.classList.add("run");
    }
  }
  function schedule() {
    if (timer) clearInterval(timer);
    timer = null;
    if (pages.length > 1 && !reduceMotion) {
      timer = setInterval(function () { showPage(pageIdx + 1); }, PAGE_MS);
    }
  }

  function render() {
    renderHeader();
    renderFresh();
    renderVerdict();
    renderAlerts();
    renderSections();
    renderHistory();
    renderFoot();
    paginate();
  }

  render();
  $("prev").addEventListener("click", function () { showPage(pageIdx - 1); schedule(); });
  $("next").addEventListener("click", function () { showPage(pageIdx + 1); schedule(); });
  window.addEventListener("hashchange", function () {
    stateName = (location.hash || "").replace("#", "") || "healthy";
    view = data[stateName] || data.healthy;
    loadedAt = Date.now();
    render();
  });
  var resizeT = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeT);
    resizeT = setTimeout(paginate, 200);
  });
  /* Tick ages forward once a minute (cheap; a wall screen stays open for hours). */
  setInterval(function () { renderFresh(); renderAlerts(); }, 60000);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(paginate);
})();
