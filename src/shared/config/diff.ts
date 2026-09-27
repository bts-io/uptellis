/**
 * Field-level diff of two configs (or any JSON values) for the admin editor, the import dry run and the
 * revision list. Objects are compared key by key and arrays index by index, so a changed section title is
 * one `change` at `sections.1.title`, and a new trailing section is one `add` at `sections.2`. A value that
 * changes type (object, array or scalar) is one `change` of the whole value. Keys follow `before`'s order,
 * then keys only in `after`.
 */
import type { ConfigDiffEntry } from "../schemas/admin";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

const kind = (v: unknown) =>
  Array.isArray(v) ? "array" : v !== null && typeof v === "object" ? "object" : "scalar";

const join = (prefix: string, key: string | number) => (prefix ? `${prefix}.${key}` : String(key));

/** JSON form of a value: drops `undefined` fields exactly as storing and exporting a config does. */
const plain = (v: unknown): Json => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

function walk(a: Json, b: Json, path: string, out: ConfigDiffEntry[]): void {
  const ka = kind(a);
  if (ka !== kind(b)) {
    out.push({ path, op: "change", before: a, after: b });
    return;
  }
  if (ka === "array") {
    const xs = a as Json[];
    const ys = b as Json[];
    for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
      const p = join(path, i);
      if (i >= xs.length) out.push({ path: p, op: "add", after: ys[i] });
      else if (i >= ys.length) out.push({ path: p, op: "remove", before: xs[i] });
      else walk(xs[i]!, ys[i]!, p, out);
    }
    return;
  }
  if (ka === "object") {
    const xa = a as Record<string, Json>;
    const xb = b as Record<string, Json>;
    for (const k of Object.keys(xa)) {
      const p = join(path, k);
      if (Object.hasOwn(xb, k)) walk(xa[k]!, xb[k]!, p, out);
      else out.push({ path: p, op: "remove", before: xa[k] });
    }
    for (const k of Object.keys(xb)) {
      if (!Object.hasOwn(xa, k)) out.push({ path: join(path, k), op: "add", after: xb[k] });
    }
    return;
  }
  if (a !== b) out.push({ path, op: "change", before: a, after: b });
}

/** The changes that turn `before` into `after`; empty when they are equal as JSON. */
export function diffConfigs(before: unknown, after: unknown): ConfigDiffEntry[] {
  const out: ConfigDiffEntry[] = [];
  walk(plain(before), plain(after), "", out);
  return out;
}
