/** Compact age: `34s`, `14m 05s`, `3h 5m`, `2d 4h`. */
export function fmtAge(s: number): string {
  const n = Math.max(0, Math.floor(s));
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${String(n % 60).padStart(2, "0")}s`;
  if (n < 86400) return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
  return `${Math.floor(n / 86400)}d ${Math.floor((n % 86400) / 3600)}h`;
}

/** `HH:MM:SS` of an ISO instant in UTC (the kit shows every time in UTC). */
export const utcTime = (iso: string) => iso.slice(11, 19);

/** `HH:MM` of an ISO instant in UTC. */
export const utcHm = (iso: string) => iso.slice(11, 16);

/** A 0..1 ratio as a percentage: `100%`, `99.31%`. */
export function fmtRatio(r: number): string {
  const p = r * 100;
  return p >= 100 ? "100%" : `${p.toFixed(2)}%`;
}

/** Minutes as `47m` or `2h 5m`. */
export const fmtMinutes = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`);

/** The ISO instant `seconds` before `now`. */
export const isoBefore = (now: string, seconds: number) =>
  new Date(Date.parse(now) - seconds * 1000).toISOString();
