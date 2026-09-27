import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { findForbiddenLiterals } from "@/shared/model";
import { loadFixture } from "../fixtures";
import { type FileFinding, scanFileList, scanFiles } from "../fixtures/literal-scan";

// The detector's own cases live in model-safety.test.ts; this file covers scanning files. Samples are
// assembled at runtime so this file passes the repo-wide scan. Addresses use RFC 5737 ranges.
const ip4 = (...parts: number[]) => parts.join(".");

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Tracked files the repo-wide scan reads (by extension; `bun.lock`, images and fonts are not text we own). */
const TEXT_EXTENSIONS = /\.(?:ts|tsx|js|mjs|json|jsonc|md|html|css|yml|yaml|toml|sh|example)$/;

/**
 * Explicit exceptions for the repo-wide scan: a file, the exact matched text, and why it is allowed.
 * Keep this empty unless a finding is truly unavoidable; prefer fixing the rule or the file.
 */
const ALLOW: readonly { file: string; match: string; reason: string }[] = [];

const show = (f: FileFinding) => `${f.file}:${f.line} ${f.kind}/${f.rule}`;
const allowed = (f: FileFinding) => ALLOW.some((a) => a.file === f.file && a.match === f.match);

function trackedTextFiles(): string[] {
  // Tracked plus untracked-but-not-ignored files, so new files are scanned before they are committed;
  // a tracked file deleted in the working tree is skipped.
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\0")
    .filter((f) => TEXT_EXTENSIONS.test(f) && existsSync(join(ROOT, f)))
    .filter((f, i, all) => all.indexOf(f) === i)
    .sort();
}

describe("repo-wide forbidden-literal scan", () => {
  const files = trackedTextFiles();

  it("covers the tracked text files, including src, tests, docs and sites", () => {
    for (const f of [
      "src/shared/model/safety.ts",
      "tests/unit/literal-scan.test.ts",
      "tests/fixtures/data/default.json",
      "sites/demo.json",
      "README.md",
      ".dev.vars.example",
    ]) {
      expect(files).toContain(f);
    }
    expect(files.some((f) => f.endsWith("bun.lock") || f.endsWith(".woff2") || f.endsWith(".png"))).toBe(
      false,
    );
  });

  it("finds no IP address, email or token-like string in any tracked text file", () => {
    const findings = scanFileList(files, ROOT).filter((f) => !allowed(f));
    expect(findings.map(show)).toEqual([]);
  });

  it("has no stale allow-list entries", () => {
    const all = scanFileList(files, ROOT);
    for (const a of ALLOW) {
      expect(a.reason.length).toBeGreaterThan(0);
      expect(
        all.some((f) => f.file === a.file && f.match === a.match),
        `${a.file} ${a.reason}`,
      ).toBe(true);
    }
  });
});

describe("scanFiles", () => {
  it("expands globs to the fixture data files", () => {
    const { files } = scanFiles(["tests/fixtures/data/**/*"], ROOT);
    expect(files).toEqual([
      "tests/fixtures/data/default.json",
      "tests/fixtures/data/incident.json",
      "tests/fixtures/data/kuma-recorded.json",
      "tests/fixtures/data/stale.json",
    ]);
  });

  it("matches nothing for a missing folder", () => {
    expect(scanFiles(["no-such-folder/**/*"], ROOT)).toEqual({ files: [], findings: [] });
  });

  it("finds nothing in tests/fixtures/data or sites/", () => {
    const { findings } = scanFiles(["tests/fixtures/data/**/*", "sites/**/*"], ROOT);
    expect(findings.map(show)).toEqual([]);
  });

  it("reports the file and line of a finding", () => {
    const dir = mkdtempSync(join(tmpdir(), "uptellis-scan-"));
    try {
      writeFileSync(
        join(dir, "bad.json"),
        `{\n  "ok": "app-1:5432",\n  "bad": "${ip4(192, 0, 2, 7)}:22"\n}\n`,
      );
      const { files, findings } = scanFiles(["*.json"], dir);
      expect(files).toEqual(["bad.json"]);
      expect(findings).toEqual([
        { kind: "ipv4", rule: "ipv4", match: ip4(192, 0, 2, 7), index: 34, file: "bad.json", line: 3 },
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("proof: a bad fixture is caught", () => {
  it("flags a monitor target carrying an IPv4 literal", () => {
    const bad = JSON.stringify({
      id: "kuma:5",
      name: "Replica Postgres",
      kind: "port",
      targetDisplay: `${ip4(100, 90, 16, 120)}:5432`,
    });
    const findings = findForbiddenLiterals(bad);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "ipv4", match: ip4(100, 90, 16, 120) });
  });

  it("the scrubbed fixture fails the scan once an address is put back", () => {
    const f = loadFixture("default");
    expect(findForbiddenLiterals(JSON.stringify(f))).toEqual([]);
    f.services[4]!.targetDisplay = `${ip4(100, 90, 16, 120)}:5432`;
    expect(findForbiddenLiterals(JSON.stringify(f)).map((x) => x.kind)).toEqual(["ipv4"]);
  });
});
