// File scanning for forbidden literals (IP addresses, emails, token-looking strings). The detector itself
// lives in `src/shared/model/safety.ts`; this file only walks files and adds file and line numbers.
import { globSync, readFileSync, statSync } from "node:fs";
import { findForbiddenLiterals, type LiteralFinding } from "../../src/shared/model/safety";

export interface FileFinding extends LiteralFinding {
  file: string;
  line: number;
}

/** Scans the given files (paths relative to `cwd`). */
export function scanFileList(files: string[], cwd: string = process.cwd()): FileFinding[] {
  const findings: FileFinding[] = [];
  for (const file of files) {
    const text = readFileSync(`${cwd}/${file}`, "utf8");
    for (const f of findForbiddenLiterals(text)) {
      findings.push({ ...f, file, line: text.slice(0, f.index).split("\n").length });
    }
  }
  return findings;
}

/** Scans every file matched by the globs (relative to `cwd`). Missing folders just match nothing. */
export function scanFiles(
  globs: string[],
  cwd: string = process.cwd(),
): { files: string[]; findings: FileFinding[] } {
  const files = [...new Set(globs.flatMap((g) => globSync(g, { cwd })))]
    .filter((f) => statSync(`${cwd}/${f}`).isFile())
    .sort();
  return { files, findings: scanFileList(files, cwd) };
}
