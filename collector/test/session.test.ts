import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHostAliases } from "../src/address";
import { BeatBuffer } from "../src/buffer";
import { wireBuffer } from "../src/collector";
import { loadConfig, readSecretFile } from "../src/config";
import { configureLog } from "../src/log";
import { ALLOWED_EMITS, KumaSession } from "../src/session";
import { findForbiddenLiterals, KumaSnapshot } from "../src/shared";
import { buildSnapshot } from "../src/snapshot";
import { createState } from "../src/state";
import { FAKE_PASSWORD, FAKE_USER, type FakeKuma, LOOPBACK, startFakeKuma } from "./fake-kuma";
import { HOST_ALIASES_JSON } from "./fixtures/kuma-events";

let kuma: FakeKuma;
beforeAll(async () => {
  configureLog({ quiet: true });
  kuma = await startFakeKuma();
});
afterAll(async () => {
  configureLog({ quiet: false });
  await kuma.close();
});

describe("KumaSession against a fake Kuma", () => {
  it("logs in once with the password, then re-authenticates with the token after a reconnect", async () => {
    kuma.received.length = 0;
    const state = createState();
    const session = new KumaSession({
      url: kuma.url,
      username: FAKE_USER,
      password: FAKE_PASSWORD,
      state,
      socketOptions: { reconnectionDelay: 50, reconnectionDelayMax: 100 },
      serverDisconnectDelayMs: 50,
    });
    session.start();
    try {
      await session.waitReady(5_000);
      await session.waitQuiet(200, 3_000);
      expect(state.monitors.size).toBe(9);
      await session.refresh();
      expect(state.info.dbSizeBytes).toBe(5_242_880);
      expect(state.important.get(5)?.length).toBe(3);

      // Server drops every client (Kuma restart, network blip).
      kuma.io.disconnectSockets();
      await Bun.sleep(50);
      await session.waitReady(5_000);
      expect(kuma.received.filter((e) => e === "login")).toHaveLength(1);
      expect(kuma.received.filter((e) => e === "loginByToken")).toHaveLength(1);

      const snap = buildSnapshot(state, new Date(), {
        host: "watch-1",
        aliases: parseHostAliases(HOST_ALIASES_JSON),
        ...session.status(),
      });
      expect(KumaSnapshot.safeParse(snap).success).toBe(true);
    } finally {
      session.stop();
    }
    // The collector never emits anything but read events.
    expect(kuma.received.every((e) => (ALLOWED_EMITS as readonly string[]).includes(e))).toBe(true);
    expect(new Set(session.emitted)).toEqual(
      new Set(["login", "loginByToken", "getDatabaseSize", "monitorImportantHeartbeatListPaged"]),
    );
  }, 15_000);

  it("reports Kuma unreachable with a login error and backs off instead of retrying hot", async () => {
    kuma.received.length = 0;
    const state = createState();
    const session = new KumaSession({
      url: kuma.url,
      username: FAKE_USER,
      password: "wrong",
      state,
      loginBackoffBaseMs: 60_000,
    });
    session.start();
    try {
      await expect(session.waitReady(1_000)).rejects.toThrow(/login failed/);
      expect(session.status()).toEqual({ reachable: false, error: "Kuma login failed (authIncorrectCreds)" });
      expect(kuma.received.filter((e) => e === "login")).toHaveLength(1);
    } finally {
      session.stop();
    }
  });

  it("reports Kuma unreachable when nothing listens", async () => {
    const session = new KumaSession({
      url: `http://${LOOPBACK}:1`,
      username: FAKE_USER,
      password: FAKE_PASSWORD,
      state: createState(),
      socketOptions: { reconnection: false },
    });
    session.start();
    await Bun.sleep(300);
    expect(session.status().reachable).toBe(false);
    session.stop();
  });

  it("feeds the buffer from the login burst (beats from the last hour only)", async () => {
    const state = createState();
    const buffer = new BeatBuffer();
    wireBuffer(state, buffer);
    const session = new KumaSession({ url: kuma.url, username: FAKE_USER, password: FAKE_PASSWORD, state });
    session.start();
    try {
      await session.waitReady(5_000);
      await session.waitQuiet(200, 3_000);
    } finally {
      session.stop();
    }
    expect(state.beats.get(1)?.length).toBe(90);
    // Fixture beats are anchored to a fixed capture time; only those inside the last hour are queued.
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const inWindow = [...state.beats.values()].flat().filter((b) => b.ts >= hourAgo).length;
    expect(buffer.size).toBe(inWindow);
  });
});

describe("--dry-run --once (end to end)", () => {
  it("prints one snapshot that parses as KumaSnapshot and carries no forbidden literal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "uptellis-collector-"));
    try {
      const pw = join(dir, "kuma-password");
      writeFileSync(pw, FAKE_PASSWORD);
      chmodSync(pw, 0o600);
      const proc = Bun.spawn(["bun", "src/main.ts", "--dry-run", "--once"], {
        cwd: join(import.meta.dir, ".."),
        env: {
          PATH: process.env.PATH,
          KUMA_URL: kuma.url,
          KUMA_USERNAME: FAKE_USER,
          KUMA_PASSWORD_FILE: pw,
          HOST_ALIASES: HOST_ALIASES_JSON,
          LIVENESS_FILE: join(dir, "alive"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [out, err, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      expect(code).toBe(0);
      const snap = KumaSnapshot.parse(JSON.parse(out));
      expect(snap.reachable).toBe(true);
      expect(snap.monitors).toHaveLength(9);
      expect(snap.kuma.dbSizeBytes).toBe(5_242_880);
      expect(snap.importantHeartbeats.filter((b) => b.monitorId === 5)).toHaveLength(3);
      expect(findForbiddenLiterals(out)).toEqual([]);
      expect(err).not.toContain(FAKE_PASSWORD);
      expect(err).toContain("collector.start");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("config", () => {
  it("refuses secret files readable by others and never echoes secrets", () => {
    const dir = mkdtempSync(join(tmpdir(), "uptellis-collector-"));
    try {
      const f = join(dir, "key");
      writeFileSync(f, "super-secret-value\n");
      chmodSync(f, 0o644);
      expect(() => readSecretFile(f, "INGEST_KEY_FILE")).toThrow(/mode 644/);
      chmodSync(f, 0o600);
      expect(readSecretFile(f, "INGEST_KEY_FILE")).toBe("super-secret-value");
      const cfg = loadConfig(
        {
          KUMA_PASSWORD: "x",
          INGEST_URL: "https://status.example.com/api/ingest/kuma",
          KEY_ID: "collector-1",
          INGEST_KEY_FILE: f,
        },
        { needIngest: true },
      );
      expect(cfg.ingest?.path).toBe("/api/ingest/kuma");
      expect(cfg.intervalS).toBe(60);
      expect(() =>
        loadConfig({ KUMA_PASSWORD: "x", INGEST_URL: "http://x.example.com/" }, { needIngest: true }),
      ).toThrow(/https/);
      expect(() => loadConfig({}, { needIngest: false })).toThrow(/KUMA_PASSWORD/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
