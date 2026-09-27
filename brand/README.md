# Uptellis brand assets

The Uptellis logo is a U-shaped tube joining two rounded squares, with a heartbeat line across the U, followed by the "Uptellis" wordmark. Everything is drawn in one left to right gradient.

**Use the full logo where there is room, the mark for icons and tight spaces.**

## Files

| File | Size | Use |
| --- | --- | --- |
| `uptellis-logo.svg` | 1947x458 viewBox | Full logo (mark + wordmark), vector. README header, docs site header. |
| `uptellis-logo.png` | 1947x458 | Full logo, transparent background, original resolution. Social preview image, places that do not take SVG. |
| `uptellis-mark.svg` | 550x550 viewBox | Mark only, vector. Docs site nav, app header, any icon use at 48px and up. |
| `uptellis-mark-small.svg` | 550x550 viewBox | Mark with thicker strokes and a simpler heartbeat, tuned for 16 to 48px. Source of the small PNGs and the favicon. |
| `uptellis-mark.png` | 1024x1024 | Mark only, transparent, from the original artwork. Avatars (GitHub org, Discord), social preview when a square is needed. |
| `favicon.ico` | 16, 32, 48 | Browser favicon (`/favicon.ico`). |
| `mark-16.png`, `mark-32.png`, `mark-48.png` | 16, 32, 48 | PNG favicons (`<link rel="icon" sizes="...">`). |
| `mark-180.png` | 180x180 | `apple-touch-icon`, solid `#0b0f14` background, about 12% padding. |
| `mark-192.png`, `mark-512.png` | 192, 512 | PWA manifest icons, transparent. |

Example README header:

```html
<p align="center"><img src="brand/uptellis-logo.svg" alt="Uptellis" width="420"></p>
```

## Colours

| Role | Hex |
| --- | --- |
| Gradient start (left, green) | `#13f23a` |
| Gradient end (right, cyan) | `#00e5ff` |
| Inner squares | `#0a2621` |
| Dark background (apple-touch-icon, dark UI) | `#0b0f14` |

The gradient always runs horizontally, green on the left to cyan on the right. The SVGs add mid stops (`#0ff960`, `#08f8aa`, `#03fbf2`) so the middle stays bright like the original artwork instead of going muddy.

## Minimum sizes

- Full logo: 120px wide on screen (the wordmark stops being readable below that). Use the mark instead when there is less room.
- Mark: 48px and up with `uptellis-mark.svg`; 16 to 48px with `uptellis-mark-small.svg` or the prebuilt PNGs.

## Clear space

Keep empty space around the logo and the mark at least as wide as one of the rounded squares at the top of the mark (about a quarter of the mark's height). Do not place text, borders or other logos inside that space.

## Do not

- Recolour the logo, change the gradient direction, or add outlines, shadows or glows.
- Stretch or squash it; always scale proportionally.
- Rebuild the wordmark from a font; use the files here.
- Put it on busy photos or mid-tone backgrounds. It works on white and on dark (`#0b0f14`) backgrounds.
