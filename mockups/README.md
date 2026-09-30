# Phase 7a theme mock-ups

Static HTML mock-ups of six new theme directions, rendered from the same data the product uses. They are for choosing; the picked ones become real themes in 7b. Nothing here is loaded by the app.

## Shared rules (every direction)

- **Files:** `mockups/<direction>/index.html`, plus optional `style.css` and `app.js` in the same folder. Load the data with `<script src="../data/demo.js"></script>` and read `window.UPTELLIS_DEMO`.
- **Data:** `window.UPTELLIS_DEMO.{healthy, incident, stale}` is the real `SiteView` (types in `src/shared/view/types.ts`, built by `buildSiteView`). Render everything from it: never hard-code service names, counts, verdicts or times. The state is picked by the URL hash: `#healthy` (the default when there is none), `#incident`, `#stale`.
- **Must show in every state:** the site name and branding, the verdict (use `verdict.label` verbatim), the sections and their services with state, a 90-day history (`beats90d` or `beatsText`), incidents (`incidents`: open ones prominently, then recent), the freshness or stale notice when `freshness.state` is not fresh (`#stale` must make it obvious the data is old), maintenance when present, and links.
- **Responsive:** one page that works at 1440 px and at 390 px wide (phone). No horizontal scroll on a phone.
- **Not terminal-styled:** no monospace-first look, no green-on-black, no prompt or shell metaphors. Monospace is fine for small values such as latencies.
- **Self-contained:** vanilla HTML, CSS and JS; no frameworks, no CDN. The only allowed external request is Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`). No images other than inline SVG.
- **Accessible:** semantic HTML (header, main, section, lists, headings in order), text contrast AA, states never shown by colour alone (label or icon too), `prefers-reduced-motion` respected.
- **Check before you finish:** `bun mockups/check.ts <direction>` must print only `ok` lines (it loads each state at both widths in a headless DOM and fails on script errors, missing name or verdict, external references or an empty page).
- **No screenshots, no browsers, no visual iteration:** build from the brief, run the checker, report. The lead takes and reviews the screenshots.

## Directions

1. **`classic`: classic status page.** The familiar hosted status page: light, calm, trustworthy. A banner with the overall verdict at the top (green, amber or red band), then sections as bordered groups with one row per service: name, a thin 90-day bar of daily ticks, uptime percentage, a small state label. Incidents below as a dated history list with titles and resolution times. System font stack or Inter. Dark mode optional.
2. **`editorial`: editorial.** Reads like a well-set article: a large serif headline stating the verdict in a sentence, a short dateline (updated N minutes ago), generous margins and a single column on desktop. Services as a typographic list with small inline bars; incidents written as short news items. A serif display face (for example Fraunces or Source Serif) with a clean sans for data. Light background, restrained colour used only for state.
3. **`dashboard`: modern dashboard.** Soft cards in a responsive grid, charts up front: a verdict card with counts, sparkline or small area chart per service from `spark` or `recent`, latency and uptime numbers, a status donut or ring for the whole site. Light and dark (follow `prefers-color-scheme`). Rounded corners, subtle shadows, a modern sans (for example Inter or Manrope).
4. **`wallboard`: wallboard / TV.** Built for a screen across the room: huge verdict at the top, big status tiles (one per service, colour and word), readable from metres away, very few words. Rotates through sections automatically every few seconds when there are more tiles than fit (pause with `prefers-reduced-motion`). Dark background, very high contrast. On a phone it degrades to a stacked list of big tiles.
5. **`friendly`: friendly / rounded.** Warm and approachable for a non-technical audience: plain-language verdict ("Everything is running smoothly"), rounded pill states, soft pastel colours, a friendly rounded sans (for example Nunito or Quicksand), a small illustrative inline SVG for the overall state. Technical details (latency, targets) tucked behind a disclosure. Incidents in plain words.
6. **`minimal`: minimal / one-line.** As little as possible: one line with the verdict and a coloured dot, then a compact list of services (name and state), a tiny 90-day strip per service, incidents only when there are open ones plus a single "past incidents" link-like list. Great on a phone and for embedding. System font, lots of whitespace, near-monochrome with colour only for state.
