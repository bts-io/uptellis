// Environment configuration, validated with zod. The API key comes from a file (systemd credential or
// Docker secret) or the environment; errors name the variable, never its value.
import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { AgentId } from "./shared";

export interface Config {
  /** Origin (and optional base path) of the Uptellis instance, without a trailing slash. */
  baseUrl: string;
  apiKey: string;
  runner: string;
  dataDir: string;
  concurrency: number;
  livenessFile: string | null;
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

/** `localhost` or an IPv4 loopback address (a local instance may skip TLS). */
const isLocal = (host: string) => host === "localhost" || /^127(?:\.\d{1,3}){3}$/.test(host);
const truthy = (v: string | undefined) => v === "1" || v === "true" || v === "yes";

/** `upt_<12 id chars>_<43 secret chars>`, the format the instance issues. */
const API_KEY = /^upt_[a-z0-9]{12}_[A-Za-z0-9_-]{43}$/;

const Env = z.object({
  UPTELLIS_URL: z.string({ error: "UPTELLIS_URL is required" }).min(1, "UPTELLIS_URL is required"),
  UPTELLIS_RUNNER: z.string({ error: "UPTELLIS_RUNNER is required (the agent id, e.g. office-1)" }),
  UPTELLIS_DATA_DIR: z.string().min(1).default("/var/lib/uptellis-agent"),
  UPTELLIS_CONCURRENCY: z.coerce
    .number({ error: "UPTELLIS_CONCURRENCY must be a number" })
    .int("UPTELLIS_CONCURRENCY must be a whole number")
    .min(1, "UPTELLIS_CONCURRENCY must be 1 to 64")
    .max(64, "UPTELLIS_CONCURRENCY must be 1 to 64")
    .default(8),
  UPTELLIS_LIVENESS_FILE: z.string().optional(),
  UPTELLIS_ALLOW_HTTP: z.string().optional(),
});

export function loadConfig(env: Env): Config {
  // Only the variables this schema knows; empty strings count as unset.
  const picked = Object.fromEntries(
    Object.keys(Env.shape).map((k) => [k, env[k] === "" ? undefined : env[k]]),
  );
  const parsed = Env.safeParse(picked);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "invalid environment");
  const e = parsed.data;

  let url: URL;
  try {
    url = new URL(e.UPTELLIS_URL);
  } catch {
    throw new Error("UPTELLIS_URL is not a URL");
  }
  if (url.username || url.password) throw new Error("UPTELLIS_URL must not carry credentials");
  if (url.protocol !== "https:") {
    const allowed = url.protocol === "http:" && (isLocal(url.hostname) || truthy(e.UPTELLIS_ALLOW_HTTP));
    if (!allowed) throw new Error("UPTELLIS_URL must be https (UPTELLIS_ALLOW_HTTP=1 allows http)");
  }
  if (url.search || url.hash) throw new Error("UPTELLIS_URL must not have a query or fragment");

  if (!AgentId.safeParse(e.UPTELLIS_RUNNER).success) {
    throw new Error("UPTELLIS_RUNNER must be an agent id like office-1 (not cf, server or builtin)");
  }

  const keyFile = env.UPTELLIS_API_KEY_FILE;
  const apiKey = keyFile ? readSecretFile(keyFile, "UPTELLIS_API_KEY_FILE") : env.UPTELLIS_API_KEY?.trim();
  if (!apiKey) throw new Error("UPTELLIS_API_KEY_FILE (or UPTELLIS_API_KEY) is required");
  if (!API_KEY.test(apiKey)) throw new Error("UPTELLIS_API_KEY is not an Uptellis API key (upt_...)");

  return {
    baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`,
    apiKey,
    runner: e.UPTELLIS_RUNNER,
    dataDir: e.UPTELLIS_DATA_DIR,
    concurrency: e.UPTELLIS_CONCURRENCY,
    livenessFile: e.UPTELLIS_LIVENESS_FILE ?? null,
  };
}
