import { z } from "zod";

/**
 * Display safety. Nothing that reaches a rendered surface (page, embed, JSON, Discord card) may carry an
 * address literal, an email address or anything that looks like a credential. Every display field in the
 * model runs through `safeDisplay()`; the theme audit test and the repo-wide scan in
 * `tests/unit/literal-scan.test.ts` reuse `findForbiddenLiterals()`. This is the only detector in the repo.
 *
 * Allowed on purpose: hostnames with ports (`app-1:5432`), dotted versions (`16.0.5`, `2.5.5`), clock
 * times (`23:57:41`), ISO dates, short git hashes (`cbe27a13`), UUIDs, URLs on hostnames, prose such as
 * "the Bearer of bad news" or "Basic Information".
 */

export const FORBIDDEN_LITERAL_KINDS = ["ipv4", "ipv6", "email", "token"] as const;
export type ForbiddenLiteralKind = (typeof FORBIDDEN_LITERAL_KINDS)[number];

export interface LiteralFinding {
  kind: ForbiddenLiteralKind;
  /** Which rule fired, e.g. `github-token` or `hex-run`. */
  rule: string;
  match: string;
  index: number;
}

interface Rule {
  kind: ForbiddenLiteralKind;
  rule: string;
  re: RegExp;
  /** Generic rules are dropped where a specific rule already covers the same span. */
  generic?: boolean;
  accept?: (match: string) => boolean;
  /** Trims the raw match (e.g. a sentence-ending dot) before `accept` and reporting. */
  trim?: (match: string) => string;
}

const HEX_GROUP = /^[0-9a-f]{1,4}$/i;
const DOTTED_QUAD = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const isIPv4Literal = (s: string) => {
  const m = DOTTED_QUAD.exec(s);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
};

/**
 * True for a full or `::` compressed IPv6 literal, including an embedded IPv4 tail (`::ffff:a.b.c.d`).
 * A bare `::` is not reported (it carries no address and shows up in prose and code).
 */
export function isIPv6Literal(candidate: string): boolean {
  if (!/[0-9a-f]/i.test(candidate)) return false;
  let groups = candidate;
  let tail = 0;
  const lastColon = candidate.lastIndexOf(":");
  if (candidate.slice(lastColon + 1).includes(".")) {
    if (!isIPv4Literal(candidate.slice(lastColon + 1))) return false;
    groups = candidate.slice(0, lastColon + 1);
    groups = groups.endsWith("::") ? groups : groups.slice(0, -1);
    tail = 2;
  }
  const halves = groups.split("::");
  if (halves.length > 2) return false;
  const split = (part: string) => (part === "" ? [] : part.split(":"));
  if (halves.length === 2) {
    const all = [...split(halves[0]!), ...split(halves[1]!)];
    return all.length + tail <= 7 && all.every((g) => HEX_GROUP.test(g));
  }
  const all = split(groups);
  return all.length + tail === 8 && all.every((g) => HEX_GROUP.test(g));
}

const hasUpper = (s: string) => /[A-Z]/.test(s);
const hasLower = (s: string) => /[a-z]/.test(s);
const hasDigit = (s: string) => /\d/.test(s);
/** Real keys mix upper case, lower case and digits; slugs, paths and identifiers rarely do all three. */
const mixed = (s: string) => hasUpper(s) && hasLower(s) && hasDigit(s);

const RULES: readonly Rule[] = [
  {
    kind: "ipv4",
    rule: "ipv4",
    // Not part of a longer dotted number run, so 5-part versions never match and 3-part versions cannot.
    // A trailing `:port` or `/prefix` is left out of the match (a scrub keeps it).
    re: /(?<![\d.])\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?!\d|\.\d)/g,
    accept: isIPv4Literal,
  },
  {
    kind: "ipv6",
    rule: "ipv6",
    // Candidate runs of hex, colons and dots; `isIPv6Literal` decides. `23:57:41` has 3 groups and no `::`.
    re: /(?<![\w:.])[0-9a-f]*:[0-9a-f:.]*(?![\w:])/gi,
    trim: (m) => m.replace(/\.+$/, ""),
    accept: isIPv6Literal,
  },
  { kind: "email", rule: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  {
    kind: "token",
    rule: "bearer",
    // A credential after `Bearer`: 20+ token characters, or 6+ with a digit or `._~+/=` (not a word).
    re: /\bBearer\s+[A-Za-z0-9\-._~+/]{6,}=*/g,
    accept: (m) => {
      const cred = m.replace(/^\S+\s+/, "");
      return cred.length >= 20 || /[\d._~+/=]/.test(cred);
    },
  },
  {
    kind: "token",
    rule: "basic-auth",
    re: /\bBasic\s+[A-Za-z0-9+/]{8,}={0,2}/g,
    accept: (m) => /[\d+/=]/.test(m.replace(/^\S+\s+/, "")),
  },
  { kind: "token", rule: "tailscale-key", re: /\btskey-[A-Za-z0-9-]{8,}/g },
  { kind: "token", rule: "github-pat", re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { kind: "token", rule: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: "token", rule: "gitlab-token", re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: "token", rule: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{8,}/g },
  {
    kind: "token",
    rule: "sk-key",
    re: /\bsk[-_](?:live_|test_)?[A-Za-z0-9_-]{16,}/g,
    accept: hasDigit,
  },
  { kind: "token", rule: "aws-access-key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "token", rule: "jwt", re: /\beyJ[\w-]{8,}\.[\w-]{8,}(?:\.[\w-]*)?/g },
  {
    kind: "token",
    rule: "discord-webhook",
    re: /https?:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/g,
  },
  { kind: "token", rule: "hex-run", re: /(?<![0-9A-Za-z])[0-9a-fA-F]{32,}(?![0-9A-Za-z])/g, generic: true },
  {
    kind: "token",
    rule: "base64-run",
    re: /(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{32,}={0,2}/g,
    generic: true,
    // Mixed classes overall, and at least one 20+ character segment between slashes (paths have short ones).
    accept: (m) => mixed(m) && m.split("/").some((seg) => seg.length >= 20 && mixed(seg)),
  },
];

/** Every forbidden literal in `text`, in order of position. */
export function findForbiddenLiterals(text: string): LiteralFinding[] {
  const found: (LiteralFinding & { generic: boolean })[] = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    for (const m of text.matchAll(r.re)) {
      const match = r.trim ? r.trim(m[0]) : m[0];
      if (!match || (r.accept && !r.accept(match))) continue;
      found.push({ kind: r.kind, rule: r.rule, match, index: m.index, generic: !!r.generic });
    }
  }
  const specific = found.filter((f) => !f.generic);
  const covered = (f: LiteralFinding) =>
    specific.some((s) => f.index < s.index + s.match.length && s.index < f.index + f.match.length);
  return found
    .filter((f) => !f.generic || !covered(f))
    .sort((a, b) => a.index - b.index)
    .map(({ generic: _, ...f }) => f);
}

/** The kind of the first forbidden literal in `s`, or null when the text is safe to display. */
export function findForbiddenLiteral(s: string): ForbiddenLiteralKind | null {
  return findForbiddenLiterals(s)[0]?.kind ?? null;
}

/** True when `s` contains an IPv4 or IPv6 literal, an email address or a token-like string. */
export function containsForbiddenLiteral(s: string): boolean {
  return findForbiddenLiteral(s) !== null;
}

/** Replaces every forbidden literal in `s` (for adapters that must keep a message but drop what it leaks). */
export function scrubForbiddenLiterals(s: string, replacement = "[redacted]"): string {
  // Merge overlapping spans (an IPv6 literal with an IPv4 tail), then replace right to left.
  const spans: [number, number][] = [];
  for (const f of findForbiddenLiterals(s)) {
    const end = f.index + f.match.length;
    const last = spans.at(-1);
    if (last && f.index < last[1]) last[1] = Math.max(last[1], end);
    else spans.push([f.index, end]);
  }
  let out = s;
  for (const [start, end] of spans.reverse()) out = out.slice(0, start) + replacement + out.slice(end);
  return out;
}

const KIND_LABEL: Record<ForbiddenLiteralKind, string> = {
  ipv4: "an IPv4 address",
  ipv6: "an IPv6 address",
  email: "an email address",
  token: "a token or secret",
};

/** A non-empty display string of at most `max` characters that carries no forbidden literal. */
export const safeDisplay = (max = 200) =>
  z
    .string()
    .min(1)
    .max(max)
    .superRefine((s, ctx) => {
      const kind = findForbiddenLiteral(s);
      if (kind)
        ctx.addIssue({ code: "custom", message: `Display text must not contain ${KIND_LABEL[kind]}` });
    });

/** Default display string (names, titles, labels): 1 to 200 characters, no forbidden literal. */
export const SafeDisplay = safeDisplay(200);
export type SafeDisplay = z.infer<typeof SafeDisplay>;
