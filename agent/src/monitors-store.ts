// The last monitor list the instance sent, with its ETag, kept in the data directory so a restart while
// the instance is unreachable keeps checking (and the next poll can still answer 304).
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from "node:fs";
import { join } from "node:path";
import { AgentMonitorsResponse } from "./shared";

export const MONITORS_FILE = "monitors.json";

export interface StoredMonitors {
  etag: string | null;
  response: AgentMonitorsResponse;
}

export function loadMonitors(dir: string, runner: string): StoredMonitors | null {
  const path = join(dir, MONITORS_FILE);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { etag?: unknown; response?: unknown };
    const response = AgentMonitorsResponse.safeParse(raw.response);
    if (!response.success || response.data.runner !== runner) return null;
    return { etag: typeof raw.etag === "string" ? raw.etag : null, response: response.data };
  } catch {
    return null;
  }
}

export function saveMonitors(dir: string, stored: StoredMonitors): void {
  const path = join(dir, MONITORS_FILE);
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w", 0o600);
  try {
    writeSync(fd, JSON.stringify(stored));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
