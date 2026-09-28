// Results not yet acknowledged, on disk so a restart or a long outage loses nothing.
//
// `results.jsonl` in the data directory is an append-only log of two kinds of line:
//   {"s":<seq>,"r":<CheckResult>}   one result, in the order the checks finished
//   {"a":<seq>}                     every result with a seq up to <seq> is gone (sent, refused or evicted)
// Results only ever leave from the head (oldest first), so one number describes each removal. Appends are
// fsynced before `append` returns; a torn last line (a crash mid-write) is skipped on load. Once the dead
// lines outweigh the live ones the log is compacted: the live results go to a temporary file, fsynced, then
// renamed over the log.
//
// Capped: results older than `maxAgeMs` (24 h, the instance ignores older ones anyway) and the oldest
// beyond `maxResults` (50 000) are evicted.
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { log } from "./log";
import { CheckResult, MAX_RESULT_AGE_S } from "./shared";

export const BUFFER_FILE = "results.jsonl";
export const MAX_BUFFERED_RESULTS = 50_000;
export const MAX_BUFFER_AGE_MS = MAX_RESULT_AGE_S * 1000;
/** Compaction never runs for a log smaller than this. */
const COMPACT_MIN_BYTES = 256 * 1024;

export interface Entry {
  seq: number;
  result: CheckResult;
  /** UTF-8 bytes of the result's JSON, for batching under the request cap. */
  bytes: number;
}

export interface BufferOptions {
  maxResults?: number;
  maxAgeMs?: number;
  now?: () => number;
}

export class ResultBuffer {
  private entries: Entry[] = [];
  private head = 0;
  private nextSeq = 1;
  private fd: number;
  private fileBytes = 0;
  private deadBytes = 0;
  private readonly path: string;
  private readonly maxResults: number;
  private readonly maxAgeMs: number;
  private readonly now: () => number;
  /** Results evicted (too old or over the cap) since start. */
  evicted = 0;

  constructor(
    readonly dir: string,
    opts: BufferOptions = {},
  ) {
    this.maxResults = opts.maxResults ?? MAX_BUFFERED_RESULTS;
    this.maxAgeMs = opts.maxAgeMs ?? MAX_BUFFER_AGE_MS;
    this.now = opts.now ?? Date.now;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.path = join(dir, BUFFER_FILE);
    const skipped = this.load();
    // Start from a clean log: drops the acknowledgement lines and any torn line.
    this.fd = -1;
    this.rewrite();
    this.fd = openSync(this.path, "a", 0o600);
    if (this.size > 0 || skipped > 0) log("info", "buffer.loaded", { pending: this.size, skipped });
    this.evict();
  }

  private load(): number {
    if (!existsSync(this.path)) return 0;
    let skipped = 0;
    let acked = 0;
    const kept = new Map<number, Entry>();
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line) continue;
      let rec: unknown;
      try {
        rec = JSON.parse(line);
      } catch {
        skipped++;
        continue;
      }
      if (typeof rec !== "object" || rec === null) {
        skipped++;
        continue;
      }
      const r = rec as { s?: unknown; r?: unknown; a?: unknown };
      if (typeof r.a === "number") {
        acked = Math.max(acked, r.a);
        continue;
      }
      const parsed = CheckResult.safeParse(r.r);
      if (typeof r.s !== "number" || !parsed.success) {
        skipped++;
        continue;
      }
      kept.set(r.s, { seq: r.s, result: parsed.data, bytes: Buffer.byteLength(JSON.stringify(parsed.data)) });
    }
    this.entries = [...kept.values()].filter((e) => e.seq > acked).sort((a, b) => a.seq - b.seq);
    const last = this.entries.at(-1);
    this.nextSeq = Math.max(acked, last?.seq ?? 0) + 1;
    return skipped;
  }

  /** Writes the live results to a new log and renames it over the old one. */
  private rewrite(): void {
    const tmp = `${this.path}.tmp`;
    const fd = openSync(tmp, "w", 0o600);
    let bytes = 0;
    try {
      const lines: string[] = [];
      for (let i = this.head; i < this.entries.length; i++) {
        const e = this.entries[i]!;
        lines.push(JSON.stringify({ s: e.seq, r: e.result }));
        if (lines.length === 1000 || i === this.entries.length - 1) {
          const chunk = `${lines.join("\n")}\n`;
          bytes += writeSync(fd, chunk);
          lines.length = 0;
        }
      }
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (this.fd >= 0) closeSync(this.fd);
    renameSync(tmp, this.path);
    syncDir(this.dir);
    this.entries = this.entries.slice(this.head);
    this.head = 0;
    this.fileBytes = bytes;
    this.deadBytes = 0;
    if (this.fd >= 0) this.fd = openSync(this.path, "a", 0o600);
  }

  private writeLine(text: string): void {
    this.fileBytes += writeSync(this.fd, text);
  }

  get size(): number {
    return this.entries.length - this.head;
  }

  /** Appends results (in the order given) and fsyncs them before returning. */
  append(results: readonly CheckResult[]): void {
    if (results.length === 0) return;
    const lines: string[] = [];
    for (const result of results) {
      const e: Entry = { seq: this.nextSeq++, result, bytes: Buffer.byteLength(JSON.stringify(result)) };
      this.entries.push(e);
      lines.push(JSON.stringify({ s: e.seq, r: result }));
    }
    this.writeLine(`${lines.join("\n")}\n`);
    fsyncSync(this.fd);
    this.evict();
  }

  /** The oldest results, at most `limit`, oldest first. */
  peek(limit: number): Entry[] {
    this.evict();
    return this.entries.slice(this.head, this.head + limit);
  }

  /** Removes every result up to and including `seq` (they were delivered or refused). */
  drop(seq: number): number {
    let n = 0;
    let bytes = 0;
    while (this.head < this.entries.length && this.entries[this.head]!.seq <= seq) {
      bytes += this.entries[this.head]!.bytes + 16;
      this.head++;
      n++;
    }
    if (n === 0) return 0;
    this.writeLine(`${JSON.stringify({ a: seq })}\n`);
    fsyncSync(this.fd);
    this.deadBytes += bytes;
    this.maybeCompact();
    return n;
  }

  /** Evicts results older than the age cap and the oldest beyond the count cap. */
  evict(): number {
    const cutoff = this.now() - this.maxAgeMs;
    let last = -1;
    let i = this.head;
    // Results enter in the order checks finish, which follows their start time to within a check's
    // timeout, so the old ones are at the head.
    while (i < this.entries.length && Date.parse(this.entries[i]!.result.ts) < cutoff) last = i++;
    const over = this.entries.length - this.head - this.maxResults;
    if (over > 0) last = Math.max(last, this.head + over - 1);
    if (last < this.head) return 0;
    const n = this.drop(this.entries[last]!.seq);
    this.evicted += n;
    log("warn", "buffer.evicted", { results: n, pending: this.size });
    return n;
  }

  private maybeCompact(): void {
    if (this.fileBytes < COMPACT_MIN_BYTES) {
      if (this.size === 0 && this.fileBytes > 0 && this.deadBytes > 0) this.compact();
      return;
    }
    if (this.deadBytes * 2 >= this.fileBytes) this.compact();
  }

  /** Rewrites the log with the live results only. */
  compact(): void {
    this.rewrite();
  }

  close(): void {
    if (this.fd < 0) return;
    try {
      fsyncSync(this.fd);
    } finally {
      closeSync(this.fd);
      this.fd = -1;
    }
  }
}

function syncDir(dir: string): void {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // Some filesystems refuse fsync on a directory; the rename is still atomic.
  }
}
