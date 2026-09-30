# Phase 7b: six new themes

The mock-ups on branch `p7/mockups` (`mockups/<name>/`, screenshots on issue #1) were approved. Each becomes a real theme. This page is the contract every theme stream builds against.

| Theme id | Mock-up | `dataTheme` | Module export |
|---|---|---|---|
| `d-classic` | `mockups/classic` | `d` | `dClassic` |
| `e-editorial` | `mockups/editorial` | `e` | `eEditorial` |
| `f-dashboard` | `mockups/dashboard` | `f` | `fDashboard` |
| `g-wallboard` | `mockups/wallboard` | `g` | `gWallboard` |
| `h-friendly` | `mockups/friendly` | `h` | `hFriendly` |
| `i-minimal` | `mockups/minimal` | `i` | `iMinimal` |

Read a mock-up with `git show p7/mockups:mockups/<name>/app.js` (also `index.html`, `style.css`).

## What already exists (do not redo)

- The ids are in `THEME_IDS` (`src/shared/config/site.ts`).
- Each theme has a stub folder `src/client/themes/<id>/` with `index.ts` (the `ThemeModule` and `THEME_COLOR`), a placeholder `Page.tsx` and `tokens.css`, which `src/client/styles.css` already imports.

## What a theme stream does

1. **Build the theme** in its own folder only: `Page.tsx` plus any components, `format.ts` helpers and `tokens.css`. Port the mock-up faithfully (layout, type, colour, states) to React 19 and Tailwind v4, the way the existing themes do (read `src/client/themes/b-control-room/` as the reference). Themes import only `@/client/kit`, `@/client/effects`, `@/shared/view` types and their own files (Biome enforces it). Reuse kit components where they fit (`StaleBanner`, `MaintenanceNotice`, `beat-bar`, `sparkline`, `age`, `verdict`, `icon`...), and style them through the theme.
2. **Render on the server:** no `window`, `document` or timers during render. Live things (ticking ages, the wallboard rotation) go through `@/client/effects` or `useEffect`, the way existing themes do.
3. **Tokens and fonts:** scope everything to `[data-theme="<letter>"]` in `tokens.css`. Fonts must be self-hosted (the CSP allows `font-src 'self'` only): download the latin variable `woff2` from Fontsource on jsDelivr, e.g. `https://cdn.jsdelivr.net/npm/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2`, save it under `public/fonts/` with a clear name (`Inter-Variable.woff2`), and declare the `@font-face` in the theme's `tokens.css`. Skip a font that another theme already added (check `public/fonts/`). Report each new font's name and licence (SIL OFL 1.1) so the lead adds it to `public/fonts/LICENSES.md` (do not edit that file).
4. **Register the theme** with exactly two one-line additions (the lead merges these lines across streams):
   - `src/client/themes/index.ts`: an import of `THEME_COLOR as <LETTER>_THEME_COLOR` and the module, and the entry `"<id>": { module: <export>, themeColor: <LETTER>_THEME_COLOR },` after `c-session`.
   - `tests/support/registered-themes.ts`: `"<id>": { dataTheme: "<letter>", themeColor: "<same hex>" },`.
5. **Pass the conformance tests** that run over every registered theme: `tests/unit/theme-anchors.test.ts` (one `svc` anchor per service, the Kuma update note), `tests/unit/theme-maintenance.test.ts` (the maintenance notice with its end), `tests/unit/theme-profiles.test.ts` (sites without profiles, a new profile), `tests/unit/client-preview.test.ts` and `tests/unit/client-shell.test.ts`. Read them first: they are the definition of done for the data a theme must show. Add a `tests/unit/theme-<letter>.test.ts` for the theme's own behaviour (states healthy, incident, stale, maintenance; phone-safe markup), in the style of `theme-b.test.ts`.
6. **Fix the flaws noted on the mock-ups:** classic said "Updated just now" during an incident (show the real age); minimal's stale sentence had stray brackets; the wallboard's down tile wrapped "99.85% 30 d".

## Rules

- Do not touch other themes' folders, `src/client/shell/keys.ts` (no key hints for these themes), `src/client/styles.css`, `public/fonts/LICENSES.md`, or anything outside your folder, the two registration lines, your tests and `public/fonts/`.
- Code, tests and verify only: no screenshots, no browsers, no visual iteration. The lead reviews screenshots. If the contract is unclear or a conformance test seems wrong for a theme, stop and report.
- No commits (the lead signs). Give a commit plan: Conventional Commits, lower-case subject, header at most 100 characters.
- No em dashes or en dashes anywhere. No real host names (use the demo data).
- Before finishing: `bunx biome check --write .`, `bun run verify` and `bun run leak-check`, each exit 0, output under `/home/hani/.claude/jobs/d904cf4e/tmp/p7b-<name>/`.
