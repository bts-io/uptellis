/**
 * Docker reads its secrets and settings from env vars. Each `NAME` may instead be given as `NAME_FILE`, the
 * path of a file holding the value (Docker and Compose secrets mount them under /run/secrets); a set
 * `NAME` wins over `NAME_FILE`. Values are trimmed and an empty value counts as unset.
 */
import { readFileSync } from "node:fs";

export type EnvSource = Readonly<Record<string, string | undefined>>;

const FILE_SUFFIX = "_FILE";

const clean = (v: string | undefined) => {
  const t = v?.trim();
  return t ? t : undefined;
};

/** `NAME`, else the contents of the file `NAME_FILE` names; undefined when neither is set. */
export function readEnv(env: EnvSource, name: string): string | undefined {
  const direct = clean(env[name]);
  if (direct !== undefined) return direct;
  const file = clean(env[`${name}${FILE_SUFFIX}`]);
  return file === undefined ? undefined : clean(readFileSync(file, "utf8"));
}

/** Every variable whose name matches `pattern`, given directly or as `<NAME>_FILE`, read as above. */
export function readEnvMatching(env: EnvSource, pattern: RegExp): Record<string, string> {
  const names = new Set<string>();
  for (const key of Object.keys(env)) {
    const name = key.endsWith(FILE_SUFFIX) ? key.slice(0, -FILE_SUFFIX.length) : key;
    if (pattern.test(name)) names.add(name);
  }
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = readEnv(env, name);
    if (value !== undefined) out[name] = value;
  }
  return out;
}
