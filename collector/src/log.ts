// One JSON line per event on stderr. Callers pass counts, ids, field paths and error codes only: never a
// payload, a credential, a token or a Kuma message (which can hold addresses).
export type Level = "debug" | "info" | "warn" | "error";

let quiet = false;
let debug = false;

export function configureLog(opts: { quiet?: boolean; debug?: boolean }): void {
  quiet = opts.quiet ?? quiet;
  debug = opts.debug ?? debug;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  if (quiet && level !== "error") return;
  if (level === "debug" && !debug) return;
  process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), level, event, ...fields })}\n`);
}
