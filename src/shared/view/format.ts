/** Small pure formatters shared by the view-model modules (no clock reads: every age is passed in). */

export const toMs = (t: Date | number | string) =>
  t instanceof Date ? t.getTime() : typeof t === "number" ? t : Date.parse(t);

/** ISO timestamp at whole seconds, the model's style (`2026-09-27T23:58:00Z`). */
export const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");

/** `HH:MM:SS` of an ISO timestamp (UTC). */
export const clock = (ts: string) => iso(toMs(ts)).slice(11, 19);

export const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Integers as they are, other numbers with at most two decimals (`41.2`, `0.33`). */
export const formatNumber = (n: number) => String(Number.isInteger(n) ? n : round(n, 2));

/** A span of seconds: `0 s`, `42 s`, `27 min`, `3 h 5 min`, `2 d 4 h`. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  const pair = (big: number, bigUnit: string, small: number, smallUnit: string) =>
    small ? `${big} ${bigUnit} ${small} ${smallUnit}` : `${big} ${bigUnit}`;
  if (s < 86_400) return pair(Math.floor(s / 3600), "h", Math.floor((s % 3600) / 60), "min");
  return pair(Math.floor(s / 86_400), "d", Math.floor((s % 86_400) / 3600), "h");
}

/** `27 min ago` for a past instant, `in 3 h` for a future one, `just now` inside a second. */
export function formatRelative(deltaS: number): string {
  if (Math.abs(deltaS) < 1) return "just now";
  return deltaS > 0 ? `${formatDuration(deltaS)} ago` : `in ${formatDuration(-deltaS)}`;
}

const BYTE_UNITS = ["KiB", "MiB", "GiB", "TiB", "PiB"];

/** Binary units with one decimal: `512 B`, `73.7 MiB`, `12.0 GiB`. */
export function formatBytes(bytes: number): string {
  if (Math.abs(bytes) < 1024) return `${bytes} B`;
  let v = bytes;
  let unit = "B";
  for (const u of BYTE_UNITS) {
    if (Math.abs(v) < 1024) break;
    v /= 1024;
    unit = u;
  }
  return `${v.toFixed(1)} ${unit}`;
}

/** `lagSeconds` -> `Lag seconds`, `db_size` -> `Db size`; dots and hyphens stay (host names in keys). */
export function humanize(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** `99.86%` from a ratio. */
export const formatPercent = (ratio: number) => `${(ratio * 100).toFixed(2)}%`;
