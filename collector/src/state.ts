// In-memory mirror of what Kuma pushes over socket.io. Reducers take the raw event arguments exactly as
// Kuma 2.5.5 emits them (see README "Kuma events") and keep only the fields the snapshot needs. Raw
// monitor objects carry secrets (auth headers, passwords, database strings), so nothing here stores them.

export interface MonitorConfig {
  id: number;
  name: string;
  type: string;
  url: string | null;
  hostname: string | null;
  port: number | null;
  method: string | null;
  intervalS: number;
  timeoutS: number | null;
  active: boolean;
}

export interface Beat {
  monitorId: number;
  /** ISO 8601 UTC. */
  ts: string;
  status: 0 | 1 | 2 | 3;
  pingMs: number | null;
  msg: string | null;
  important: boolean;
}

export interface CertRaw {
  valid: boolean;
  cn: string | null;
  issuer: string | null;
  validTo: string | null;
  daysRemaining: number | null;
}

export interface KumaState {
  monitors: Map<number, MonitorConfig>;
  /** Recent beats per monitor, oldest first, capped at `MAX_BEATS_PER_MONITOR`. */
  beats: Map<number, Beat[]>;
  important: Map<number, Beat[]>;
  avgPing: Map<number, number | null>;
  uptime24: Map<number, number | null>;
  uptime720: Map<number, number | null>;
  cert: Map<number, CertRaw | null>;
  info: {
    version: string | null;
    latestVersion: string | null;
    timezone: string | null;
    timezoneOffset: string | null;
    dbSizeBytes: number | null;
  };
  /** Set once `monitorList` has arrived after a login. */
  monitorListAt: number | null;
  /** Called for every beat seen (list or live), for the unsent-heartbeat buffer. */
  onBeat?: (b: Beat) => void;
}

export const MAX_BEATS_PER_MONITOR = 200;

export function createState(): KumaState {
  return {
    monitors: new Map(),
    beats: new Map(),
    important: new Map(),
    avgPing: new Map(),
    uptime24: new Map(),
    uptime720: new Map(),
    cert: new Map(),
    info: { version: null, latestVersion: null, timezone: null, timezoneOffset: null, dbSizeBytes: null },
    monitorListAt: null,
  };
}

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const bool = (v: unknown) => v === true || v === 1 || v === "1";
const monitorIdOf = (v: unknown): number | null => {
  const n = num(v);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Kuma stores beat time as UTC `YYYY-MM-DD HH:mm:ss.SSS` (`R.isoDateTimeMillis(dayjs.utc())`).
 * Returns ISO 8601 with `Z`, or null when unparseable.
 */
export function kumaTimeToIso(v: unknown): string | null {
  if (typeof v !== "string" && !(v instanceof Date)) return null;
  let d: Date;
  if (v instanceof Date) d = v;
  else {
    const s = v.trim();
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s);
    d = new Date(hasZone ? s.replace(" ", "T") : `${s.replace(" ", "T")}Z`);
  }
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Monitor config from one `monitorList` entry; null for an entry we cannot use. */
export function toMonitorConfig(raw: unknown): MonitorConfig | null {
  if (!isObj(raw)) return null;
  const id = monitorIdOf(raw.id);
  const name = str(raw.name);
  const type = str(raw.type);
  if (id === null || !name || !type) return null;
  const port = num(raw.port);
  const interval = num(raw.interval);
  const timeout = num(raw.timeout);
  return {
    id,
    name,
    type,
    url: str(raw.url),
    hostname: str(raw.hostname),
    port: port !== null && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null,
    method: str(raw.method),
    intervalS: interval !== null && interval > 0 ? Math.max(1, Math.round(interval)) : 60,
    // Kuma stores 0 when no per-check timeout is set.
    timeoutS: timeout !== null && timeout > 0 ? timeout : null,
    // `active` is Kuma's effective status (false when paused or when a parent group is paused).
    active: bool(raw.active),
  };
}

/** One beat from `heartbeatList` rows (snake case), live `heartbeat` or paged important lists (camel case). */
export function toBeat(raw: unknown, fallbackMonitorId?: number): Beat | null {
  if (!isObj(raw)) return null;
  const monitorId =
    monitorIdOf(raw.monitorID ?? raw.monitor_id ?? raw.monitorId) ?? fallbackMonitorId ?? null;
  const ts = kumaTimeToIso(raw.time);
  const status = num(raw.status);
  if (monitorId === null || !ts || (status !== 0 && status !== 1 && status !== 2 && status !== 3))
    return null;
  const ping = num(raw.ping);
  return {
    monitorId,
    ts,
    status,
    pingMs: ping !== null && ping >= 0 ? ping : null,
    msg: typeof raw.msg === "string" ? raw.msg : null,
    important: bool(raw.important),
  };
}

const byTs = (a: Beat, b: Beat) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);

function mergeBeats(existing: Beat[], incoming: Beat[], cap: number): Beat[] {
  const seen = new Map(existing.map((b) => [b.ts, b]));
  for (const b of incoming) seen.set(b.ts, b);
  return [...seen.values()].sort(byTs).slice(-cap);
}

/** `monitorList` (object keyed by id) or `updateMonitorIntoList` (same shape, a subset). */
export function applyMonitorList(state: KumaState, list: unknown, replace: boolean, now = Date.now()): void {
  if (!isObj(list)) return;
  const next = replace ? new Map<number, MonitorConfig>() : new Map(state.monitors);
  for (const raw of Object.values(list)) {
    const m = toMonitorConfig(raw);
    if (m) next.set(m.id, m);
  }
  state.monitors = next;
  if (replace) {
    for (const map of [
      state.beats,
      state.important,
      state.avgPing,
      state.uptime24,
      state.uptime720,
      state.cert,
    ]) {
      for (const id of map.keys()) if (!next.has(id)) map.delete(id);
    }
    state.monitorListAt = now;
  }
}

export function applyDeleteMonitor(state: KumaState, monitorId: unknown): void {
  const id = monitorIdOf(monitorId);
  if (id === null) return;
  for (const map of [
    state.monitors,
    state.beats,
    state.important,
    state.avgPing,
    state.uptime24,
    state.uptime720,
    state.cert,
  ]) {
    map.delete(id);
  }
}

/** `heartbeatList(monitorID, rows, overwrite)`: last 100 beats of a monitor, oldest first. */
export function applyHeartbeatList(
  state: KumaState,
  monitorId: unknown,
  rows: unknown,
  overwrite = false,
): void {
  const id = monitorIdOf(monitorId);
  if (id === null || !Array.isArray(rows)) return;
  const beats = rows.map((r) => toBeat(r, id)).filter((b): b is Beat => b !== null && b.monitorId === id);
  state.beats.set(id, mergeBeats(overwrite ? [] : (state.beats.get(id) ?? []), beats, MAX_BEATS_PER_MONITOR));
  for (const b of beats) state.onBeat?.(b);
  const imp = beats.filter((b) => b.important);
  if (imp.length) state.important.set(id, mergeBeats(state.important.get(id) ?? [], imp, 50));
}

/** Live `heartbeat` event (Heartbeat.toJSON()). */
export function applyHeartbeat(state: KumaState, raw: unknown): void {
  const b = toBeat(raw);
  if (!b) return;
  state.beats.set(b.monitorId, mergeBeats(state.beats.get(b.monitorId) ?? [], [b], MAX_BEATS_PER_MONITOR));
  if (b.important)
    state.important.set(b.monitorId, mergeBeats(state.important.get(b.monitorId) ?? [], [b], 50));
  state.onBeat?.(b);
}

/** Callback data of `monitorImportantHeartbeatListPaged` (newest first): replaces the monitor's list. */
export function applyImportantList(state: KumaState, monitorId: number, rows: unknown): void {
  if (!Array.isArray(rows)) return;
  const beats = rows
    .map((r) => toBeat(r, monitorId))
    .filter((b): b is Beat => b !== null && b.monitorId === monitorId)
    .map((b) => ({ ...b, important: true }));
  state.important.set(monitorId, mergeBeats([], beats, 50));
}

export function applyAvgPing(state: KumaState, monitorId: unknown, value: unknown): void {
  const id = monitorIdOf(monitorId);
  if (id === null) return;
  const n = num(value);
  state.avgPing.set(id, n !== null && n >= 0 ? n : null);
}

/** `uptime(monitorID, period, ratio)`: period 24 (hours), 720 (30 days) or "1y" (ignored). */
export function applyUptime(state: KumaState, monitorId: unknown, period: unknown, value: unknown): void {
  const id = monitorIdOf(monitorId);
  if (id === null) return;
  const n = num(value);
  const ratio = n === null ? null : Math.min(1, Math.max(0, n));
  if (period === 24 || period === "24") state.uptime24.set(id, ratio);
  else if (period === 720 || period === "720") state.uptime720.set(id, ratio);
}

/**
 * `certInfo(monitorID, infoJson)`: a JSON string `{ valid, certInfo }` where certInfo is Node's
 * `getPeerCertificate(true)` plus Kuma's `validTo` and `daysRemaining`.
 */
export function parseCertInfo(json: unknown): CertRaw | null {
  let obj: unknown = json;
  if (typeof json === "string") {
    try {
      obj = JSON.parse(json);
    } catch {
      return null;
    }
  }
  if (!isObj(obj) || !isObj(obj.certInfo)) return null;
  const c = obj.certInfo;
  const subject = isObj(c.subject) ? c.subject : {};
  const issuer = isObj(c.issuer) ? c.issuer : {};
  const pick = (v: unknown) => (Array.isArray(v) ? str(v[0]) : str(v));
  const validTo =
    kumaTimeToIso(c.validTo ?? null) ??
    (typeof c.valid_to === "string" ? kumaTimeToIso(new Date(c.valid_to)) : null);
  const days = num(c.daysRemaining);
  return {
    valid: obj.valid === true,
    cn: pick(subject.CN),
    issuer: pick(issuer.CN) ?? pick(issuer.O),
    validTo,
    daysRemaining: days === null ? null : Math.trunc(days),
  };
}

export function applyCertInfo(state: KumaState, monitorId: unknown, json: unknown): void {
  const id = monitorIdOf(monitorId);
  if (id === null) return;
  state.cert.set(id, parseCertInfo(json));
}

/** `info` event. Sent once before login without version fields, and again after login with them. */
export function applyInfo(state: KumaState, raw: unknown): void {
  if (!isObj(raw)) return;
  if ("version" in raw) state.info.version = str(raw.version);
  if ("latestVersion" in raw) state.info.latestVersion = str(raw.latestVersion);
  if ("serverTimezone" in raw) state.info.timezone = str(raw.serverTimezone);
  if ("serverTimezoneOffset" in raw) state.info.timezoneOffset = str(raw.serverTimezoneOffset);
}

/** `getDatabaseSize` callback `{ ok, size }` (bytes; 0 on MariaDB). */
export function applyDbSize(state: KumaState, res: unknown): void {
  if (!isObj(res) || res.ok !== true) return;
  const n = num(res.size);
  state.info.dbSizeBytes = n !== null && n >= 0 ? Math.trunc(n) : null;
}
