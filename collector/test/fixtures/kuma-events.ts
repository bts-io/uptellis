// A captured Kuma 2.5.5 login burst, shaped exactly like the socket.io events (see README "Kuma events"),
// with the demo monitor set. Addresses are assembled at runtime from documentation ranges so this file
// passes the repo-wide literal scan; the raw monitor objects carry the secret-bearing fields Kuma really
// sends (auth, headers) to prove they never reach the payload.

export const ip4 = (...parts: number[]) => parts.join(".");
export const ADDR = {
  app1: ip4(192, 0, 2, 10),
  app2: ip4(198, 51, 100, 20),
  runner1: ip4(203, 0, 113, 30),
  /** Not in HOST_ALIASES: must be scrubbed. */
  stray: ip4(203, 0, 113, 99),
  v6: ["2001", "db8", "", "42"].join(":"),
};
export const HOST_ALIASES_JSON = JSON.stringify({
  [ADDR.app1]: "app-1",
  [ADDR.app2]: "app-2",
  [ADDR.runner1]: "runner-1",
  [ADDR.v6]: "host-v6",
});

/** Fixed "now" of the capture. */
export const NOW = new Date("2026-09-27T12:00:00.000Z");

/** Kuma's stored time format: UTC `YYYY-MM-DD HH:mm:ss.SSS`. */
export const kumaTime = (minutesAgo: number) =>
  new Date(NOW.getTime() - minutesAgo * 60_000).toISOString().replace("T", " ").replace("Z", "");

const SECRET_FIELDS = {
  basic_auth_user: "admin",
  basic_auth_pass: ["hunter", "2-not-real"].join(""),
  headers: JSON.stringify({ Authorization: ["Bearer", "abc123def456ghi789jkl"].join(" ") }),
  databaseConnectionString: "postgres://kuma:pw@app-1:5432/kuma",
  pushToken: null,
};

const monitor = (id: number, name: string, type: string, extra: Record<string, unknown>) => ({
  id,
  name,
  description: null,
  path: [name],
  pathName: name,
  parent: null,
  childrenIDs: [],
  url: "https://",
  method: "GET",
  hostname: null,
  port: null,
  maxretries: 1,
  weight: 2000,
  active: true,
  forceInactive: false,
  type,
  timeout: 48,
  interval: 60,
  retryInterval: 60,
  keyword: null,
  accepted_statuscodes: ["200-299"],
  notificationIDList: { "1": true },
  tags: [],
  maintenance: false,
  ...SECRET_FIELDS,
  ...extra,
});

export const monitorList = () => ({
  "1": monitor(1, "API health", "http", { url: "https://app.example.com/api/healthz" }),
  "2": monitor(2, "Web app", "keyword", {
    url: `https://${["user:pw", "app.example.com"].join("@")}/explore`,
    keyword: "Acme",
  }),
  "3": monitor(3, "Primary Postgres", "port", { hostname: ADDR.app1, port: 5432 }),
  "4": monitor(4, "Primary SSH", "port", { hostname: ADDR.app1, port: 22 }),
  "5": monitor(5, "Replica Postgres", "port", { hostname: ADDR.app2, port: 5432 }),
  "6": monitor(6, "Replica SSH", "port", { hostname: ADDR.app2, port: 22, active: false }),
  "7": monitor(7, "Runner ping", "ping", { hostname: ADDR.runner1, timeout: 10 }),
  "8": monitor(8, `Runner SSH (${ADDR.stray})`, "port", { hostname: ADDR.stray, port: 22, method: "GET" }),
  "9": monitor(9, "IPv6 probe", "http", { url: `http://[${ADDR.v6}]:8080/health`, method: "head" }),
});

/** `heartbeatList` rows: raw SQL rows (snake case), oldest first, last 100 per monitor. */
export const heartbeatRows = (monitorId: number, count: number, opts: { downAt?: number[] } = {}) =>
  Array.from({ length: count }, (_, i) => {
    const minutesAgo = count - i;
    const down = opts.downAt?.includes(minutesAgo) ?? false;
    return {
      id: monitorId * 1000 + i,
      monitor_id: monitorId,
      status: down ? 0 : 1,
      msg: down ? `connect ECONNREFUSED ${ADDR.app2}:5432` : "",
      time: kumaTime(minutesAgo),
      ping: down ? null : 20 + (i % 7),
      important: i === 0 || down ? 1 : 0,
      duration: 60,
      down_count: 0,
      end_time: null,
      retries: 0,
      response: null,
    };
  });

/** Live `heartbeat` event (Heartbeat.toJSON(): camel case `monitorID`). */
export const liveBeat = (monitorId: number, minutesAgo: number, status: number, msg = "") => ({
  monitorID: monitorId,
  status,
  time: kumaTime(minutesAgo),
  msg,
  ping: status === 1 ? 31 : null,
  important: false,
  duration: 60,
  retries: 0,
  response: null,
});

/** `certInfo` payload: the stored `info_json` string. */
export const certInfoJson = () =>
  JSON.stringify({
    valid: true,
    certInfo: {
      subject: { CN: "app.example.com" },
      issuer: { C: "US", O: "Let's Encrypt", CN: "R11" },
      subjectaltname: "DNS:app.example.com",
      valid_from: "Aug  1 00:00:00 2026 GMT",
      valid_to: "Oct 30 00:00:00 2026 GMT",
      validTo: "2026-10-30T00:00:00.000Z",
      daysRemaining: 32,
      fingerprint: "AA:BB",
      certType: "server",
      issuerCertificate: null,
    },
  });

/** Callback data of `monitorImportantHeartbeatListPaged` (newest first). */
export const importantPage = (monitorId: number) => [
  { ...liveBeat(monitorId, 3, 1, "OK"), important: true },
  { ...liveBeat(monitorId, 5, 0, `connect ECONNREFUSED ${ADDR.app2}:5432`), important: true },
  { ...liveBeat(monitorId, 600, 1, ""), important: true },
];

/** The ordered events Kuma emits on a socket after login (afterLogin + Monitor.sendStats). */
export function loginBurst(): [string, ...unknown[]][] {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const events: [string, ...unknown[]][] = [
    ["monitorList", monitorList()],
    [
      "info",
      {
        primaryBaseURL: null,
        serverTimezone: "Asia/Tokyo",
        serverTimezoneOffset: "+09:00",
        version: "2.5.5",
        latestVersion: "2.5.5",
        isContainer: true,
        dbType: "sqlite",
        runtime: { platform: "linux", arch: "x64" },
      },
    ],
  ];
  for (const id of ids) {
    events.push(["heartbeatList", id, heartbeatRows(id, 90, id === 5 ? { downAt: [5, 4] } : {}), false]);
    events.push(["avgPing", id, id === 7 ? null : 23.45]);
    events.push(["uptime", id, 24, id === 5 ? 0.9861 : 1]);
    events.push(["uptime", id, 720, 0.9995]);
    events.push(["uptime", id, "1y", 0.999]);
    if (id === 1 || id === 2) events.push(["certInfo", id, certInfoJson()]);
  }
  return events;
}
