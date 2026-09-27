// One persistent socket.io session to Uptime Kuma 2.5.5. Kuma rate-limits `login` (20 per minute, shared
// by every client of the instance), so the password is used once: the JWT from that login re-authenticates
// with `loginByToken` after every reconnect. Transport reconnects use socket.io's exponential backoff with
// jitter; failed logins back off separately (30 s doubling to 15 min). Only read events are ever emitted.
import { io, type Socket } from "socket.io-client";
import { log } from "./log";
import {
  applyAvgPing,
  applyCertInfo,
  applyDbSize,
  applyDeleteMonitor,
  applyHeartbeat,
  applyHeartbeatList,
  applyImportantList,
  applyInfo,
  applyMonitorList,
  applyUptime,
  type KumaState,
} from "./state";

/** Every event the collector may emit. Kuma has no read-only role, so this list is the safety net. */
export const ALLOWED_EMITS = [
  "login",
  "loginByToken",
  "getMonitorList",
  "getDatabaseSize",
  "monitorImportantHeartbeatListPaged",
] as const;
export type AllowedEmit = (typeof ALLOWED_EMITS)[number];

/** Events Kuma pushes that feed the state store. */
export const LISTENED_EVENTS = [
  "info",
  "monitorList",
  "updateMonitorIntoList",
  "deleteMonitorFromList",
  "heartbeatList",
  "heartbeat",
  "avgPing",
  "uptime",
  "certInfo",
] as const;

export interface SessionOptions {
  url: string;
  username: string;
  password: string;
  state: KumaState;
  /** Important beats fetched per monitor per refresh. */
  importantCount?: number;
  callTimeoutMs?: number;
  /** For tests: socket.io client options override. */
  socketOptions?: Parameters<typeof io>[1];
  loginBackoffBaseMs?: number;
  loginBackoffMaxMs?: number;
  /** Delay before reconnecting after Kuma closed the session itself (socket.io does not retry that). */
  serverDisconnectDelayMs?: number;
}

type Ack = Record<string, unknown> | undefined;

export class KumaSession {
  private socket: Socket | null = null;
  private token: string | null = null;
  private loggedIn = false;
  private authenticating = false;
  private loginFailures = 0;
  private loginTimer: ReturnType<typeof setTimeout> | null = null;
  private callFailures = 0;
  private lastError: string | null = "not connected yet";
  /** Test hook: every emitted event name, in order. */
  readonly emitted: string[] = [];
  lastEventAt = 0;

  constructor(private readonly opts: SessionOptions) {}

  start(): void {
    if (this.socket) return;
    const s = io(this.opts.url, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 60_000,
      randomizationFactor: 0.5,
      timeout: 10_000,
      ...this.opts.socketOptions,
    });
    this.socket = s;
    const st = this.opts.state;

    s.on("connect", () => {
      log("info", "kuma.connected");
      void this.authenticate();
    });
    s.on("disconnect", (reason) => {
      this.loggedIn = false;
      this.lastError = "Kuma connection lost";
      log("warn", "kuma.disconnected", { reason });
      if (reason === "io server disconnect") {
        setTimeout(() => {
          if (this.socket === s && !s.connected) s.connect();
        }, this.opts.serverDisconnectDelayMs ?? 5_000);
      }
    });
    s.on("connect_error", (err) => {
      this.lastError = "Kuma not reachable";
      log("warn", "kuma.connect_error", { code: (err as { type?: string }).type ?? err.name });
    });

    // Every state event also stamps `lastEventAt` (used to wait out the login burst).
    const on = (event: (typeof LISTENED_EVENTS)[number], fn: (...a: unknown[]) => void) =>
      s.on(event, (...a: unknown[]) => {
        this.lastEventAt = Date.now();
        fn(...a);
      });
    on("info", (d) => applyInfo(st, d));
    on("monitorList", (d) => applyMonitorList(st, d, true));
    on("updateMonitorIntoList", (d) => applyMonitorList(st, d, false));
    on("deleteMonitorFromList", (id) => applyDeleteMonitor(st, id));
    on("heartbeatList", (id, rows, overwrite) => applyHeartbeatList(st, id, rows, overwrite === true));
    on("heartbeat", (d) => applyHeartbeat(st, d));
    on("avgPing", (id, v) => applyAvgPing(st, id, v));
    on("uptime", (id, period, v) => applyUptime(st, id, period, v));
    on("certInfo", (id, json) => applyCertInfo(st, id, json));
    // Kuma asks the browser for its timezone once; we are not a browser, so ignore it.
    s.on("initServerTimezone", () => undefined);
  }

  stop(): void {
    if (this.loginTimer) clearTimeout(this.loginTimer);
    this.loginTimer = null;
    this.socket?.removeAllListeners();
    this.socket?.close();
    this.socket = null;
    this.loggedIn = false;
  }

  get isLoggedIn(): boolean {
    return this.loggedIn;
  }

  /** Kuma reachability for the snapshot. */
  status(): { reachable: boolean; error?: string } {
    const ok = this.loggedIn && !!this.socket?.connected && this.opts.state.monitorListAt !== null;
    return ok ? { reachable: true } : { reachable: false, error: this.lastError ?? "Kuma not ready" };
  }

  private async call(event: AllowedEmit, ...args: unknown[]): Promise<Ack> {
    if (!(ALLOWED_EMITS as readonly string[]).includes(event)) throw new Error(`emit not allowed: ${event}`);
    const s = this.socket;
    if (!s?.connected) throw new Error("not connected");
    this.emitted.push(event);
    return (await s.timeout(this.opts.callTimeoutMs ?? 15_000).emitWithAck(event, ...args)) as Ack;
  }

  private async authenticate(): Promise<void> {
    if (this.authenticating) return;
    this.authenticating = true;
    try {
      if (this.token) {
        const res = await this.call("loginByToken", this.token).catch(() => undefined);
        if (res?.ok === true) {
          this.onLoggedIn("token");
          return;
        }
        // Expired, password changed, or Kuma restarted with a new secret: fall back to the password once.
        log("warn", "kuma.token_rejected", { msg: typeof res?.msg === "string" ? res.msg : "no answer" });
        this.token = null;
      }
      await this.passwordLogin();
    } finally {
      this.authenticating = false;
    }
  }

  private async passwordLogin(): Promise<void> {
    if (this.loginTimer) return; // a backoff retry is already scheduled
    let res: Ack;
    try {
      res = await this.call("login", {
        username: this.opts.username,
        password: this.opts.password,
        token: "",
      });
    } catch {
      res = undefined;
    }
    if (res?.ok === true && typeof res.token === "string") {
      this.token = res.token;
      this.onLoggedIn("password");
      return;
    }
    this.loginFailures++;
    const code = res?.tokenRequired
      ? "2FA required"
      : typeof res?.msg === "string"
        ? res.msg.slice(0, 80)
        : "no answer";
    this.lastError = `Kuma login failed (${code})`;
    const base = this.opts.loginBackoffBaseMs ?? 30_000;
    const max = this.opts.loginBackoffMaxMs ?? 15 * 60_000;
    const delay = Math.min(max, base * 2 ** (this.loginFailures - 1)) * (0.8 + Math.random() * 0.4);
    log("error", "kuma.login_failed", {
      code,
      failures: this.loginFailures,
      retryInS: Math.round(delay / 1000),
    });
    this.loginTimer = setTimeout(() => {
      this.loginTimer = null;
      if (this.socket?.connected && !this.loggedIn) void this.authenticate();
    }, delay);
  }

  private onLoggedIn(via: "token" | "password"): void {
    this.loggedIn = true;
    this.loginFailures = 0;
    this.callFailures = 0;
    this.lastError = null;
    log("info", "kuma.logged_in", { via });
  }

  /**
   * Per tick: database size (doubles as the liveness probe of the session) and the newest important beats
   * per monitor (Kuma 2.5.5 does not push them on login). Three failed probes in a row force a reconnect.
   */
  async refresh(): Promise<void> {
    if (!this.loggedIn) return;
    const st = this.opts.state;
    try {
      applyDbSize(st, await this.call("getDatabaseSize"));
      this.callFailures = 0;
    } catch {
      this.callFailures++;
      log("warn", "kuma.probe_failed", { failures: this.callFailures });
      if (this.callFailures >= 3) {
        this.callFailures = 0;
        this.loggedIn = false;
        this.lastError = "Kuma stopped answering";
        log("warn", "kuma.reconnect_forced");
        this.socket?.disconnect().connect();
      }
      return;
    }
    const count = this.opts.importantCount ?? 20;
    await Promise.all(
      [...st.monitors.keys()].map(async (id) => {
        try {
          const res = await this.call("monitorImportantHeartbeatListPaged", id, 0, count);
          if (res?.ok === true) applyImportantList(st, id, res.data);
        } catch {
          log("warn", "kuma.important_failed", { monitorId: id });
        }
      }),
    );
  }

  /** Resolves once logged in with a monitor list, or rejects after `timeoutMs`. */
  waitReady(timeoutMs: number): Promise<void> {
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (this.status().reachable) return resolve();
        if (Date.now() - started > timeoutMs) return reject(new Error(this.lastError ?? "Kuma not ready"));
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  /** Resolves when no Kuma event has arrived for `quietMs` (the login burst is over). */
  async waitQuiet(quietMs: number, maxMs: number): Promise<void> {
    const started = Date.now();
    while (Date.now() - this.lastEventAt < quietMs && Date.now() - started < maxMs) {
      await Bun.sleep(100);
    }
  }
}
