/**
 * Shields-style flat badges (`label | value`, 20 px high) as SVG strings. Text is measured with the
 * advance widths of Verdana at 11 px (the font shields.io measures with), so the boxes fit the text the way
 * a browser draws it; characters outside the table count as a wide average. All text is XML-escaped.
 */
import type { PublicState } from "@/shared/public/summary";

/** Fill of the value half by state: up green, degraded amber, down red, maintenance blue, else grey. */
export const BADGE_COLORS: Record<PublicState, string> = {
  up: "#4c1",
  degraded: "#dfb317",
  down: "#e05d44",
  maintenance: "#007ec6",
  stale: "#9f9f9f",
  unknown: "#9f9f9f",
};

const LABEL_COLOR = "#555";
const FONT_SIZE = 11;
/** Horizontal padding on each side of each half, px. */
const PAD = 5;
/** The longest text drawn in one half; longer labels are cut with an ellipsis. */
const MAX_CHARS = 64;

/** Verdana advance widths per 1000 em units, printable ASCII from space (0x20) to tilde (0x7e). */
// biome-ignore format: one row per 16 characters reads as a table
const VERDANA: readonly number[] = [
  352, 394, 459, 818, 636, 1076, 727, 269, 454, 454, 636, 818, 364, 454, 364, 454, // space to /
  636, 636, 636, 636, 636, 636, 636, 636, 636, 636, 454, 454, 818, 818, 818, 545, // 0 to ?
  1000, 684, 686, 698, 771, 632, 575, 775, 751, 421, 455, 693, 557, 843, 748, 787, // @ to O
  603, 787, 695, 684, 616, 732, 684, 989, 685, 615, 685, 454, 454, 454, 818, 636, // P to _
  636, 601, 623, 521, 623, 596, 352, 623, 633, 274, 344, 592, 274, 973, 633, 607, // ` to o
  623, 623, 427, 521, 394, 633, 592, 818, 592, 592, 525, 635, 454, 635, 818, // p to ~
];
/** Width of a character outside the table (accents, other scripts): a wide letter, so text never overflows. */
const FALLBACK = 700;

/** The rendered width of `text` in Verdana 11 px, px (not rounded). */
export function textWidth(text: string): number {
  let units = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    units += code >= 0x20 && code <= 0x7e ? (VERDANA[code - 0x20] ?? FALLBACK) : FALLBACK;
  }
  return (units * FONT_SIZE) / 1000;
}

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** `s` safe inside XML text and attribute values; control characters are dropped. */
export const escapeXml = (s: string): string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: dropping them is the point
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"']/g, (c) => XML_ESCAPES[c] ?? c);

const clip = (s: string) => {
  const chars = [...s.trim()];
  return chars.length > MAX_CHARS ? `${chars.slice(0, MAX_CHARS - 1).join("")}…` : chars.join("");
};

export interface Badge {
  label: string;
  value: string;
  state: PublicState;
}

/** The flat badge SVG for `badge`. */
export function renderBadge(badge: Badge): string {
  const label = clip(badge.label) || "status";
  const value = clip(badge.value) || "unknown";
  const labelText = Math.round(textWidth(label));
  const valueText = Math.round(textWidth(value));
  const lw = labelText + 2 * PAD;
  const vw = valueText + 2 * PAD;
  const w = lw + vw;
  const color = BADGE_COLORS[badge.state] ?? BADGE_COLORS.unknown;
  const l = escapeXml(label);
  const v = escapeXml(value);
  // Text is drawn at 10x and scaled down, as shields does, for sub-pixel positions.
  const lx = (lw / 2) * 10;
  const vx = (lw + vw / 2) * 10;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${l}: ${v}">`,
    `<title>${l}: ${v}</title>`,
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`,
    `<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>`,
    `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="${LABEL_COLOR}"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g>`,
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="110">`,
    `<text aria-hidden="true" x="${lx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${labelText * 10}">${l}</text>`,
    `<text x="${lx}" y="140" transform="scale(.1)" fill="#fff" textLength="${labelText * 10}">${l}</text>`,
    `<text aria-hidden="true" x="${vx}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${valueText * 10}">${v}</text>`,
    `<text x="${vx}" y="140" transform="scale(.1)" fill="#fff" textLength="${valueText * 10}">${v}</text>`,
    "</g></svg>",
  ].join("");
}

/** A 0 to 1 uptime as a badge value: floored to two decimals of a percent (never rounded up to 100%). */
export function formatUptime(ratio: number | null | undefined): string {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return "no data";
  const pct = Math.floor(Math.min(1, Math.max(0, ratio)) * 10000) / 100;
  return `${pct.toFixed(2).replace(/\.?0+$/, "")}%`;
}

/** The colour state of an uptime: at least 99% green, at least 95% amber, below red, no data grey. */
export function uptimeState(ratio: number | null | undefined): PublicState {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return "unknown";
  if (ratio >= 0.99) return "up";
  return ratio >= 0.95 ? "degraded" : "down";
}
