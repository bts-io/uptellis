// Address mapping and the fail-closed literal guard. Kuma monitors on the tailnet point at raw addresses;
// the payload must only ever carry host names. Known addresses map to their host name through
// `HOST_ALIASES`; anything left is replaced by `scrubForbiddenLiterals`; and before a snapshot leaves the
// process `findLiteralPaths` must come back empty, or the snapshot is not sent.
import { findForbiddenLiterals, scrubForbiddenLiterals } from "./shared";

/** Address literal -> host label, e.g. `{ "<tailnet address>": "app-1" }`. */
export type HostAliases = ReadonlyMap<string, string>;

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9.-]{0,252})$/;

/** Parses `HOST_ALIASES` (a JSON object). Throws on a malformed value without echoing it. */
export function parseHostAliases(raw: string | undefined): HostAliases {
  const out = new Map<string, string>();
  if (!raw || raw.trim() === "") return out;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new Error("HOST_ALIASES is not valid JSON");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("HOST_ALIASES must be a JSON object of address -> host name");
  }
  for (const [addr, host] of Object.entries(obj)) {
    if (typeof host !== "string" || !HOST_LABEL.test(host)) {
      throw new Error("HOST_ALIASES values must be lower-case host names");
    }
    if (findForbiddenLiterals(host).length > 0) throw new Error("HOST_ALIASES values must not be addresses");
    const key = addr.trim();
    if (key) out.set(key.toLowerCase(), host);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Longest first, so a longer address is never half-replaced by a shorter one it contains. */
const aliasPatterns = (aliases: HostAliases) =>
  [...aliases.entries()]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([addr, host]) => ({
      host,
      // `[addr]` (IPv6 in a URL) first, then the bare address not glued to a longer number or name.
      re: new RegExp(
        `\\[${escapeRe(addr)}\\]|(?<![0-9A-Za-z.:])${escapeRe(addr)}(?![0-9A-Za-z]|\\.\\d|:[0-9a-f]*:)`,
        "gi",
      ),
    }));

const cache = new WeakMap<HostAliases, ReturnType<typeof aliasPatterns>>();

/** Replaces known addresses with their host names. */
export function applyAliases(text: string, aliases: HostAliases): string {
  if (aliases.size === 0) return text;
  let pats = cache.get(aliases);
  if (!pats) {
    pats = aliasPatterns(aliases);
    cache.set(aliases, pats);
  }
  let out = text;
  for (const p of pats) out = out.replace(p.re, p.host);
  return out;
}

/** Aliases, then scrubs whatever forbidden literal is left. The one text sanitizer for the payload. */
export function sanitizeText(text: string, aliases: HostAliases): string {
  return scrubForbiddenLiterals(applyAliases(text, aliases));
}

/** Drops `user:pass@` from a URL-looking string before it is sanitized. */
export function stripUrlCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/i, "$1");
}

/**
 * Every string leaf (and object key) that still holds a forbidden literal, as a field path such as
 * `monitors[3].url`. Paths only: callers log these, never the values.
 */
export function findLiteralPaths(value: unknown, path = "$"): string[] {
  if (typeof value === "string") return findForbiddenLiterals(value).length > 0 ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => findLiteralPaths(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    const out: string[] = [];
    for (const [k, v] of Object.entries(value)) {
      if (findForbiddenLiterals(k).length > 0) out.push(`${path}.<key>`);
      out.push(...findLiteralPaths(v, `${path}.${k}`));
    }
    return out;
  }
  return [];
}
