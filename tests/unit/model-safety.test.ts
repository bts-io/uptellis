import { describe, expect, it } from "vitest";
import {
  containsForbiddenLiteral,
  findForbiddenLiteral,
  findForbiddenLiterals,
  isIPv6Literal,
  SafeDisplay,
  safeDisplay,
  scrubForbiddenLiterals,
} from "@/shared/model";

// Every positive sample is assembled at runtime so no literal address, email or token appears in the
// repository; the repo-wide scan in literal-scan.test.ts scans this file too. Addresses come from the
// documentation ranges (RFC 5737, RFC 3849).
const v4 = (...o: number[]) => o.join(".");
const v6 = (...g: string[]) => g.join(":");
const at = (user: string, domain: string) => [user, domain].join("@");
const cat = (...parts: string[]) => parts.join("");
const repeat = (s: string, n: number) => s.repeat(n);
const DOC4 = v4(192, 0, 2, 10);
const DOC6_FULL = v6("2001", "0db8", "0000", "0000", "0000", "0000", "0000", "0001");
const DOC6_SHORT = v6("2001", "db8", "", "1");
const LOOP6 = v6("", "", "1");
const LINK6 = v6("fe80", "", "1");
const MAPPED6 = `${v6("", "", "ffff")}:${DOC4}`;
const MIXED = repeat("aB3d", 8); // 32 chars, mixed case and digits
const token = (prefix: string, n = 36) => prefix + repeat("a1B2c3D4e5", Math.ceil(n / 10)).slice(0, n);

const kinds = (text: string) => findForbiddenLiterals(text).map((f) => f.kind);
const rules = (text: string) => findForbiddenLiterals(text).map((f) => f.rule);

describe("findForbiddenLiteral: rejects", () => {
  const cases: [string, string, ReturnType<typeof findForbiddenLiteral>][] = [
    ["bare IPv4", DOC4, "ipv4"],
    ["IPv4 with port", `${DOC4}:5432`, "ipv4"],
    ["IPv4 in URL", `https://${DOC4}/healthz`, "ipv4"],
    ["IPv4 URL with port", `http://${v4(203, 0, 113, 5)}:8080/health`, "ipv4"],
    ["IPv4 in JSON", `{"target":"${v4(203, 0, 113, 9)}:22"}`, "ipv4"],
    ["IPv4 in a sentence", `connect ECONNREFUSED ${DOC4}.`, "ipv4"],
    ["IPv4 CIDR", `${v4(10, 0, 0, 0)}/8`, "ipv4"],
    ["IPv4 tailnet-shaped CGNAT", v4(100, 64, 0, 1), "ipv4"],
    ["IPv4 loopback", v4(127, 0, 0, 1), "ipv4"],
    ["IPv4 zero address", v4(0, 0, 0, 0), "ipv4"],
    ["IPv4 broadcast", v4(255, 255, 255, 255), "ipv4"],
    ["IPv6 full", DOC6_FULL, "ipv6"],
    ["IPv6 compressed", DOC6_SHORT, "ipv6"],
    ["IPv6 loopback", LOOP6, "ipv6"],
    ["IPv6 link-local", LINK6, "ipv6"],
    ["IPv6 link-local long", v6("fe80", "", "1ff", "fe23", "4567", "890a"), "ipv6"],
    ["IPv6 trailing compression", `${v6("2001", "db8")}::`, "ipv6"],
    ["IPv6 bracketed with port", `[${DOC6_SHORT}]:443`, "ipv6"],
    ["IPv6 in URL", `http://[${LINK6}]/`, "ipv6"],
    ["IPv6 in JSON", `{"addr":"${v6("fd7a", "115c", "a1e0", "", "1")}"}`, "ipv6"],
    ["IPv6 end of sentence", `bound to ${LOOP6}.`, "ipv6"],
    ["IPv6 mapped IPv4", MAPPED6, "ipv6"],
    ["IPv6 upper case", v6("FE80", "", "ABCD"), "ipv6"],
    ["email", at("ops", "acme.example"), "email"],
    ["email in text", `contact ${at("ops.dev", "example.org")} now`, "email"],
    ["email plus tag", at("first.last+status", "mail.example.org"), "email"],
    ["email in JSON", `{"to":"${at("someone", "example.net")}"}`, "email"],
    ["Bearer short", cat("Authorization: Bear", "er abc.def"), "token"],
    ["Bearer long", cat("Authorization: Bear", "er ", MIXED), "token"],
    ["Bearer JWT-ish", cat("Bear", "er eyJ", repeat("abc", 6), ".", repeat("x", 10)), "token"],
    ["Basic auth", cat("Authorization: Bas", "ic dXNlcjpwYXNzd29yZA=="), "token"],
    ["Tailscale key", cat("tskey", "-auth-kAbc123"), "token"],
    ["GitHub classic", token(cat("gh", "p_")), "token"],
    ["GitHub oauth", cat("gh", "o_", repeat("Z9y8", 9)), "token"],
    ["GitHub fine-grained", token(cat("github", "_pat_")), "token"],
    ["GitLab", token(cat("gl", "pat-"), 20), "token"],
    ["Slack", cat("xo", "xb-1234-abcd"), "token"],
    ["sk key", cat("s", "k_live_", repeat("4eC39HqLyjWD", 2)), "token"],
    ["AWS key id", cat("AK", "IA", repeat("Q7", 8)), "token"],
    ["AWS session key id", cat("AS", "IA", repeat("Z2", 8)), "token"],
    ["JWT", cat("eyJ", "hbGciOiJIUzI1NiJ9.", "eyJ", "zdWIiOiIxMjM0In0.sig"), "token"],
    ["long hex secret", repeat("0123456789abcdef", 4), "token"],
    ["hex run 64", repeat("deadbeef", 8), "token"],
    ["long base64 secret", cat("Zm9vYmFyQmF6UXV4MTIz", "NDU2Nzg5MGFiY2RlZg=="), "token"],
    ["base64 after a key", `secret=${MIXED}==`, "token"],
    [
      "Discord webhook",
      cat("https://discord.com/api/web", "hooks/123456789012345678/", repeat("Ab-1", 8)),
      "token",
    ],
    [
      "discordapp webhook",
      cat("https://canary.discordapp.com/api/web", "hooks/42/", repeat("x_Y", 4)),
      "token",
    ],
  ];
  it.each(cases)("%s", (_label, s, kind) => {
    expect(containsForbiddenLiteral(s)).toBe(true);
    expect(findForbiddenLiteral(s)).toBe(kind);
  });
});

describe("findForbiddenLiterals: rules and spans", () => {
  it.each([
    ["tailscale-key", cat("tskey", "-auth-k", repeat("x1", 12))],
    ["github-token", cat("gh", "p_", repeat("A1b2", 9))],
    ["github-pat", cat("github", "_pat_11AB", repeat("cd3", 10))],
    ["bearer", cat("Bear", "er ", MIXED)],
    ["aws-access-key", cat("AK", "IA", repeat("Q7", 8))],
    ["hex-run", repeat("0123456789abcdef", 2)],
    ["base64-run", `secret=${MIXED}==`],
    ["discord-webhook", cat("https://discord.com/api/web", "hooks/1/", repeat("Ab-1", 8))],
    ["jwt", cat("eyJ", "hbGciOiJIUzI1NiJ9.", "eyJ", "zdWIiOiIxMjM0In0.sig")],
  ])("%s fires", (rule, text) => {
    expect(rules(text)).toContain(rule);
  });

  it("reports a specific token once, not also as a generic hex or base64 run", () => {
    expect(rules(cat("Bear", "er ", MIXED))).toEqual(["bearer"]);
    expect(rules(cat("gh", "p_", repeat("A1b2", 9)))).toEqual(["github-token"]);
  });

  it("keeps the port out of an IPv4 match", () => {
    const f = findForbiddenLiterals(`${v4(192, 0, 2, 44)}:5432`);
    expect(f).toEqual([{ kind: "ipv4", rule: "ipv4", match: v4(192, 0, 2, 44), index: 0 }]);
  });

  it("drops a sentence-ending dot from an IPv6 match", () => {
    expect(findForbiddenLiterals(`at ${LOOP6}.`)[0]?.match).toBe(LOOP6);
  });

  it("reports both the IPv6 literal and its IPv4 tail, in position order", () => {
    expect(kinds(MAPPED6)).toEqual(["ipv6", "ipv4"]);
  });

  it("flags every kind in one seeded blob", () => {
    const bad = [DOC4, DOC6_SHORT, at("alerts", "example.com"), cat("tskey", "-client-", repeat("k7", 10))];
    expect(new Set(kinds(bad.join(" ")))).toEqual(new Set(["ipv4", "ipv6", "email", "token"]));
  });
});

describe("findForbiddenLiteral: allows", () => {
  const ok = [
    "API health",
    "Runner ping",
    "app-1:5432",
    "app-2:22",
    "example.com/api/healthz",
    "https://example.com/",
    "16.0.5",
    "2.5.5",
    "forgejo 16.0.5",
    "v1.168.58",
    "v1.2.3-beta.4",
    "300.1.2.3",
    "1.2.3.4.5",
    "uptime 99.94",
    "2026-09-27",
    "2026-09-27T23:58:00Z",
    "2026-09-27T23:58:00.123Z",
    "23:57:41",
    "12:00",
    "at 23:30 UTC",
    "16:9",
    "Foo::bar",
    "a:hover::before",
    "200 - OK",
    "cbe27a13",
    "Asia/Tokyo (+09:00)",
    "Frankfurt",
    "30 daily, 12 monthly",
    "peer is a standby",
    "std::vector",
    "a :: b",
    "12G of 79G",
    "user at example",
    "@mention",
    "@types/node",
    "ops@watch-1",
    "@media (prefers-color-scheme: dark)",
    repeat("a", 31),
    "0123456789abcdef0123456789abcde",
    "some-very-long-lowercase-hostname-label-for-a-service",
    "acme-offsite-backups-and-more-words-here",
    "src/client/themes/b-control-room/index.tsx",
    "src/client/themes/B-control-room/kit2/Panel3/StateDot.tsx",
    repeat("abcdefgh", 5),
    "the Bearer of bad news",
    "bearer token auth",
    "Basic Information",
    "123e4567-e89b-12d3-a456-426614174000",
    "kuma:5:2026-09-27T23:52:00Z",
    "https://discord.com/invite/abc",
    "tskey-auth keys",
    "ghp_ prefix",
  ];
  it.each(ok)("%s", (s) => {
    expect(findForbiddenLiteral(s)).toBeNull();
  });

  it("finds nothing in typical fixture values", () => {
    const text = [
      "API health example.com/api/healthz 200 - OK",
      "app-1:5432 app-2:22 runner-1",
      "2026-09-28T23:30:00Z 73.7 MiB 30 daily, 12 monthly",
      "Example CA, 16.0.5, 2.5.5, 99.97",
      "Asia/Tokyo (+09:00)",
    ].join("\n");
    expect(findForbiddenLiterals(text)).toEqual([]);
  });
});

describe("isIPv6Literal", () => {
  it("accepts full, compressed and IPv4-tailed forms", () => {
    for (const s of [
      DOC6_FULL,
      DOC6_SHORT,
      LOOP6,
      LINK6,
      v6("1", "", ""),
      v6("a", "b", "c", "d", "e", "f", "0", "1"),
      MAPPED6,
    ])
      expect(isIPv6Literal(s)).toBe(true);
  });
  it("rejects times, too many groups, double compression, bad tails", () => {
    for (const s of [
      "23:57:41",
      "::",
      "1:2:3:4:5:6:7:8:9",
      "1::2::3",
      "12345::1",
      "a:b:c",
      `${v6("", "", "ffff")}:${v4(300, 1, 2, 3)}`,
    ]) {
      expect(isIPv6Literal(s)).toBe(false);
    }
  });
});

describe("scrubForbiddenLiterals", () => {
  it("replaces every literal and keeps the rest", () => {
    const s = `connect ECONNREFUSED ${DOC4}:5432 via ${LINK6} (${at("ops", "acme.example")})`;
    const out = scrubForbiddenLiterals(s);
    expect(out).toBe("connect ECONNREFUSED [redacted]:5432 via [redacted] ([redacted])");
    expect(containsForbiddenLiteral(out)).toBe(false);
  });
  it("replaces an IPv4-tailed IPv6 literal once", () => {
    expect(scrubForbiddenLiterals(`from ${MAPPED6}`)).toBe("from [redacted]");
  });
  it("leaves safe text untouched", () => {
    expect(scrubForbiddenLiterals("200 - OK at 23:57:41")).toBe("200 - OK at 23:57:41");
  });
});

describe("SafeDisplay", () => {
  it("accepts safe text and rejects literals with a clear message", () => {
    expect(SafeDisplay.parse("Primary Postgres")).toBe("Primary Postgres");
    const r = SafeDisplay.safeParse(`${DOC4}:22`);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain("IPv4");
  });
  it("enforces length", () => {
    expect(SafeDisplay.safeParse("").success).toBe(false);
    expect(safeDisplay(5).safeParse("123456").success).toBe(false);
    expect(safeDisplay(5).safeParse("12345").success).toBe(true);
  });
});
