// Environment configuration. Secrets come from files (Docker secrets); errors name the variable, never
// its value.
import { readFileSync, statSync } from "node:fs";
import { type HostAliases, parseHostAliases } from "./address";

export interface Config {
  kumaUrl: string;
  kumaUsername: string;
  kumaPassword: string;
  host: string;
  aliases: HostAliases;
  intervalS: number;
  bufferWindowMin: number;
  livenessFile: string | null;
  /** Absent in `--dry-run` and `--record`. */
  ingest: IngestConfig | null;
}

export interface IngestConfig {
  url: string;
  path: string;
  keyId: string;
  key: string;
  accessClientId: string | null;
  accessClientSecret: string | null;
}

type Env = Record<string, string | undefined>;

/** Reads a secret file; refuses one that group or others can read (expects mode 600 or 400). */
export function readSecretFile(path: string, name: string): string {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch {
    throw new Error(`${name}: file not found`);
  }
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `${name}: file is readable by group or others (mode ${(mode & 0o777).toString(8)}), expected 600`,
    );
  }
  const value = readFileSync(path, "utf8").trim();
  if (!value) throw new Error(`${name}: file is empty`);
  return value;
}

function secret(env: Env, name: string, required: boolean): string | null {
  const file = env[`${name}_FILE`];
  if (file) return readSecretFile(file, `${name}_FILE`);
  const v = env[name];
  if (v) return v;
  if (required) throw new Error(`${name}_FILE (or ${name}) is required`);
  return null;
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;
const KEY_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export function loadConfig(env: Env, opts: { needIngest: boolean }): Config {
  const host = env.COLLECTOR_HOST ?? "watch-1";
  if (!HOST_LABEL.test(host)) throw new Error("COLLECTOR_HOST must be a host label like watch-1");
  const aliasesRaw = env.HOST_ALIASES_FILE ? readFileSync(env.HOST_ALIASES_FILE, "utf8") : env.HOST_ALIASES;
  const intervalS = Number(env.INTERVAL_S ?? 60);
  if (!Number.isFinite(intervalS) || intervalS < 10) throw new Error("INTERVAL_S must be at least 10");
  const bufferWindowMin = Number(env.BUFFER_WINDOW_MIN ?? 60);
  if (!Number.isFinite(bufferWindowMin) || bufferWindowMin < 1)
    throw new Error("BUFFER_WINDOW_MIN must be >= 1");

  let ingest: IngestConfig | null = null;
  if (opts.needIngest) {
    const url = env.INGEST_URL;
    if (!url) throw new Error("INGEST_URL is required");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("INGEST_URL is not a URL");
    }
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
      throw new Error("INGEST_URL must be https");
    }
    const keyId = env.KEY_ID ?? "";
    if (!KEY_ID.test(keyId)) throw new Error("KEY_ID is required (e.g. collector-1)");
    const keyFile = env.INGEST_KEY_FILE;
    if (!keyFile) throw new Error("INGEST_KEY_FILE is required");
    ingest = {
      url: parsed.toString(),
      path: parsed.pathname,
      keyId,
      key: readSecretFile(keyFile, "INGEST_KEY_FILE"),
      accessClientId: env.CF_ACCESS_CLIENT_ID || null,
      // The Access secret is only read when an Access client id is configured (no Access in front of the
      // Worker yet); an empty or absent secret file is fine then.
      accessClientSecret: env.CF_ACCESS_CLIENT_ID ? secret(env, "CF_ACCESS_CLIENT_SECRET", false) : null,
    };
    if (!!ingest.accessClientId !== !!ingest.accessClientSecret) {
      throw new Error("CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET_FILE go together");
    }
  }

  return {
    kumaUrl: env.KUMA_URL ?? "http://localhost:3001",
    kumaUsername: env.KUMA_USERNAME ?? "admin",
    kumaPassword: secret(env, "KUMA_PASSWORD", true)!,
    host,
    aliases: parseHostAliases(aliasesRaw),
    intervalS,
    bufferWindowMin,
    livenessFile: env.LIVENESS_FILE === "" ? null : (env.LIVENESS_FILE ?? "/tmp/collector-alive"),
    ingest,
  };
}
