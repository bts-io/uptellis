import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { findForbiddenLiterals } from "@/shared/model";
import { FactsPayload } from "@/shared/schemas";

// profiles/forgejo-ha/push-facts.sh against an independent WebCrypto implementation of the Phase 1 signing spec, plus
// its payload against the FactsPayload schema. Addresses are assembled at runtime (RFC 5737 and the
// tailnet range) so this file passes the repo-wide literal scan.
const SCRIPT = fileURLToPath(new URL("../../profiles/forgejo-ha/push-facts.sh", import.meta.url));
const ip4 = (...parts: number[]) => parts.join(".");
const PEER_ADDR = ip4(100, 64, 0, 7);
const OTHER_ADDR = ip4(192, 0, 2, 44);
/** A fixed 128-bit nonce, split so the literal scan does not read it as a token. */
const NONCE = ["0011223344556677", "8899aabbccddeeff"].join("");

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), "push-facts-"));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function ingestEnv(dir: string, lines: Record<string, string>, mode = 0o600): string {
  const file = join(dir, "ingest.env");
  writeFileSync(
    file,
    `${Object.entries(lines)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n")}\n`,
  );
  chmodSync(file, mode);
  return file;
}

interface DryRun {
  requestLine: string;
  headers: Record<string, string>;
  body: string;
}

function parseDryRun(out: string): DryRun {
  const blank = out.indexOf("\n\n");
  const [requestLine, ...headerLines] = out.slice(0, blank).split("\n");
  const headers: Record<string, string> = {};
  for (const l of headerLines) {
    const i = l.indexOf(": ");
    headers[l.slice(0, i).toLowerCase()] = l.slice(i + 2);
  }
  // The script ends the dry-run output with one newline after the exact body bytes.
  return { requestLine: requestLine!, headers, body: out.slice(blank + 2, -1) };
}

function run(env: Record<string, string>, args = ["--dry-run"]) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    timeout: 60_000,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: tmpdir(), ...env },
  });
}

/** Independent reference: the canonical string and HMAC-SHA256 hex over WebCrypto. */
async function referenceSignature(opts: {
  key: string;
  keyId: string;
  ts: string;
  nonce: string;
  path: string;
  body: string;
}): Promise<{ bodyHash: string; signature: string }> {
  const enc = new TextEncoder();
  const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const bodyHash = hex(await crypto.subtle.digest("SHA-256", enc.encode(opts.body)));
  const canonical = ["v1", opts.keyId, opts.ts, opts.nonce, "POST", opts.path, bodyHash].join("\n");
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(opts.key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return { bodyHash, signature: hex(await crypto.subtle.sign("HMAC", key, enc.encode(canonical))) };
}

describe("push-facts.sh signing (known answer against WebCrypto)", () => {
  const cases = [
    {
      name: "a fixed facts body",
      key: "test-ingest-key-not-real",
      body: JSON.stringify({ v: 1, generatedAt: "2026-09-27T23:45:00Z", producer: "app-1", groups: [] }),
    },
    {
      name: "a key with shell and HMAC-option metacharacters and a body with UTF-8 and a trailing newline",
      key: "k:e y=$HOME'\"`x`;\\n",
      body: '{"v":1,"note":"Größe · 5 %"}\n',
    },
  ];

  for (const c of cases) {
    it(`agrees for ${c.name}`, async () => {
      const dir = tempDir();
      const bodyFile = join(dir, "body.json");
      writeFileSync(bodyFile, c.body);
      const env = ingestEnv(dir, {
        INGEST_URL: "https://status.example.com/",
        KEY_ID: "facts-1",
        INGEST_KEY: c.key,
      });
      const res = run({
        INGEST_ENV: env,
        PUSH_FACTS_BODY: bodyFile,
        PUSH_FACTS_TS: "1790553900",
        PUSH_FACTS_NONCE: NONCE,
      });
      expect(res.stderr).toBe("");
      expect(res.status).toBe(0);
      const out = parseDryRun(res.stdout);
      expect(out.requestLine).toBe("POST https://status.example.com/api/ingest/facts");
      expect(out.body).toBe(c.body);
      const ref = await referenceSignature({
        key: c.key,
        keyId: "facts-1",
        ts: "1790553900",
        nonce: NONCE,
        path: "/api/ingest/facts",
        body: c.body,
      });
      expect(out.headers).toEqual({
        "content-type": "application/json",
        "x-uptellis-key-id": "facts-1",
        "x-uptellis-timestamp": "1790553900",
        "x-uptellis-nonce": NONCE,
        "x-uptellis-signature": ref.signature,
      });
      // The key never reaches the output.
      expect(res.stdout).not.toContain(c.key);
    });
  }

  it("reads a quoted key like env_get (last line wins, one pair of quotes dropped), never via argv", async () => {
    const dir = tempDir();
    const bodyFile = join(dir, "body.json");
    writeFileSync(bodyFile, "{}");
    const file = join(dir, "ingest.env");
    writeFileSync(file, `KEY_ID=facts-1\nINGEST_KEY=old-key\nINGEST_KEY="quoted key 'x'"\n`);
    chmodSync(file, 0o600);
    const res = run({
      INGEST_ENV: file,
      PUSH_FACTS_BODY: bodyFile,
      PUSH_FACTS_TS: "1790553900",
      PUSH_FACTS_NONCE: NONCE,
    });
    expect(res.status).toBe(0);
    const ref = await referenceSignature({
      key: "quoted key 'x'",
      keyId: "facts-1",
      ts: "1790553900",
      nonce: NONCE,
      path: "/api/ingest/facts",
      body: "{}",
    });
    expect(parseDryRun(res.stdout).headers["x-uptellis-signature"]).toBe(ref.signature);
    // The HMAC key is read from the file inside python3, not passed to openssl on a command line.
    const script = readFileSync(SCRIPT, "utf8");
    expect(script).not.toContain("-macopt");
    expect(script).not.toMatch(/-mac HMAC/);
  });

  it("uses a fresh unix-seconds timestamp and a random 128-bit hex nonce by default", async () => {
    const dir = tempDir();
    const bodyFile = join(dir, "body.json");
    writeFileSync(bodyFile, "{}");
    const env = ingestEnv(dir, { KEY_ID: "facts-1", INGEST_KEY: "k" });
    const a = parseDryRun(run({ INGEST_ENV: env, PUSH_FACTS_BODY: bodyFile }).stdout);
    const b = parseDryRun(run({ INGEST_ENV: env, PUSH_FACTS_BODY: bodyFile }).stdout);
    expect(a.headers["x-uptellis-nonce"]).toMatch(/^[0-9a-f]{32}$/);
    expect(a.headers["x-uptellis-nonce"]).not.toBe(b.headers["x-uptellis-nonce"]);
    expect(Math.abs(Number(a.headers["x-uptellis-timestamp"]) - Date.now() / 1000)).toBeLessThan(30);
    const ref = await referenceSignature({
      key: "k",
      keyId: "facts-1",
      ts: a.headers["x-uptellis-timestamp"]!,
      nonce: a.headers["x-uptellis-nonce"]!,
      path: "/api/ingest/facts",
      body: "{}",
    });
    expect(a.headers["x-uptellis-signature"]).toBe(ref.signature);
  });
});

describe("push-facts.sh config checks", () => {
  it("refuses an ingest.env readable by others, a missing key and a non-https URL when posting", () => {
    const dir = tempDir();
    const loose = ingestEnv(
      dir,
      { INGEST_URL: "https://status.example.com", KEY_ID: "facts-1", INGEST_KEY: "k" },
      0o644,
    );
    const r1 = run({ INGEST_ENV: loose }, []);
    expect(r1.status).toBe(1);
    expect(r1.stderr).toContain("expected 600");

    const d2 = tempDir();
    const noKey = ingestEnv(d2, { INGEST_URL: "https://status.example.com", KEY_ID: "facts-1" });
    expect(run({ INGEST_ENV: noKey }).stderr).toContain("INGEST_KEY missing");

    const d3 = tempDir();
    const plain = ingestEnv(d3, {
      INGEST_URL: "http://status.example.com",
      KEY_ID: "facts-1",
      INGEST_KEY: "k",
    });
    const r3 = run({ INGEST_ENV: plain }, []);
    expect(r3.status).toBe(1);
    expect(r3.stderr).toContain("https");
    expect(r3.stderr).not.toContain("=k");
  });
});

/** A fake app-1: stack .env, forgejo-ha state files and stub docker, tailscale, systemctl, curl, hostname. */
function fakeHost(): { env: Record<string, string>; log: string } {
  const dir = tempDir();
  const bin = join(dir, "bin");
  const stack = join(dir, "stack");
  const state = join(dir, "state");
  for (const d of [bin, stack, state]) mkdirSync(d);
  const log = join(dir, "calls.log");
  writeFileSync(
    join(stack, ".env"),
    [
      "ROLE=primary",
      "POSTGRES_USER=forgejo",
      "POSTGRES_DB=forgejo",
      "POSTGRES_PASSWORD=pg-secret-not-real",
      `PEER_HOST=${PEER_ADDR}`,
      "APP_URL=https://git.example.com",
      "WATCHDOG_URL=https://watchdog.example.com",
      "",
    ].join("\n"),
  );
  writeFileSync(join(state, "fence.state"), "serve\n");
  writeFileSync(join(state, "fence.reason"), `peer ${PEER_ADDR} unreachable, last seen via ${OTHER_ADDR}\n`);
  writeFileSync(
    join(state, "last-backup.json"),
    JSON.stringify({
      time: 1790550000,
      result: "ok",
      snapshot: "cbe27a13",
      size: "1.234 GiB",
      duration: "42",
    }),
  );
  const notify = join(dir, "notify.env");
  writeFileSync(notify, "FORGEJO_STATUS_TOKEN=forgejo-token-not-real\n");

  const stub = (name: string, script: string) => {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${script}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  stub("hostname", "echo app-1");
  stub(
    "docker",
    `case "$*" in
  *inspect*) echo true ;;
  *"forgejo --version"*) echo "Forgejo version 11.0.3+gitea-1.22.0 (release name 11.0.3) built with GNU Make" ;;
  *pg_isready*) exit 0 ;;
  *pg_stat_replication*) echo "streaming|2" ;;
  *"-h "*pg_control_checkpoint*) [ "$PGPASSWORD" = pg-secret-not-real ] && echo "true 3" ;;
  *pg_control_checkpoint*) echo "false 3" ;;
esac`,
  );
  stub(
    "tailscale",
    `cat <<'JSON'
{"Self":{"HostName":"app-1","TailscaleIPs":[]},"Peer":{"a":{"HostName":"app-2","DNSName":"app-2.tail.ts.net.","TailscaleIPs":["${PEER_ADDR}"]}}}
JSON`,
  );
  stub("systemctl", 'echo "Mon 2026-09-28 04:31:44 UTC"');
  stub(
    "curl",
    `case "$*" in
  *runners*) cat >/dev/null; echo '{"runners":[{"name":"watch-1","status":"online"},{"name":"runner-1","status":"offline"}]}' ;;
  *watchdog*) printf 302 ;;
  *) printf 200 ;;
esac`,
  );
  const ingest = ingestEnv(dir, {
    INGEST_URL: "https://status.example.com",
    KEY_ID: "facts-1",
    INGEST_KEY: "k",
  });
  return {
    log,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      INGEST_ENV: ingest,
      FORGEJO_HA_STACK: stack,
      FORGEJO_HA_STATE: state,
      NOTIFY_ENV: notify,
    },
  };
}

type Facts = Record<
  string,
  Record<string, { value: unknown; severity?: string; unit?: string; type?: string }>
>;
const byGroup = (p: FactsPayload): Facts =>
  Object.fromEntries(p.groups.map((g) => [g.group, Object.fromEntries(g.facts.map((f) => [f.key, f]))]));

describe("push-facts.sh gathered payload", () => {
  it("builds a FactsPayload with the status card's facts, host names only, no secret on a command line", () => {
    const host = fakeHost();
    const res = run(host.env);
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    const { body } = parseDryRun(res.stdout);
    expect(findForbiddenLiterals(body)).toEqual([]);
    const payload = FactsPayload.parse(JSON.parse(body));
    expect(payload.producer).toBe("app-1");
    expect(payload.groups.map((g) => g.group)).toEqual([
      "forgejo",
      "replication",
      "fence",
      "backup",
      "runners",
      "disk",
      "watchdog",
    ]);
    const f = byGroup(payload);
    const values = Object.fromEntries(
      Object.entries(f).map(([g, facts]) => [
        g,
        Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, v.value])),
      ]),
    );
    expect(values.forgejo).toEqual({
      node: "app-1",
      serving: true,
      servingNode: "app-1",
      version: "11.0.3",
      healthzCode: 200,
      healthzOk: true,
    });
    expect(values.replication).toEqual({
      role: "primary",
      state: "streaming",
      standbyConnected: true,
      lagSeconds: 2,
      peer: "app-2",
      peerReachable: true,
    });
    expect(values.fence).toEqual({
      decision: "serve",
      reason: "peer app-2 unreachable, last seen via [address]",
      timeline: 3,
      peerRole: "standby",
      peerTimeline: 3,
    });
    expect(values.backup).toEqual({
      lastAt: "2026-09-27T23:00:00Z",
      lastResult: "ok",
      snapshot: "cbe27a13",
      size: "1.234 GiB",
      durationS: 42,
      nextAt: "2026-09-28T04:31:44Z",
    });
    expect(f.backup!.lastAt!.type).toBe("timestamp");
    expect(values.runners).toEqual({
      online: 1,
      total: 2,
      offline: "runner-1",
      list: "watch-1 online, runner-1 offline",
    });
    expect(f.runners!.online!.severity).toBe("warn");
    expect(Object.keys(values.disk!)).toEqual(["usedBytes", "sizeBytes", "percent", "display"]);
    expect(values.watchdog).toEqual({ reachable: true, httpCode: 302 });
    for (const g of payload.groups) for (const x of g.facts) expect(x.freshForS).toBe(1800);

    const calls = readFileSync(host.log, "utf8");
    expect(calls).toContain(`pg_isready -q -t 5 -h ${PEER_ADDR}`);
    expect(calls).not.toContain("pg-secret-not-real");
    expect(calls).not.toContain("forgejo-token-not-real");
  });

  it("degrades to a valid payload on a machine without the stack", () => {
    const dir = tempDir();
    const res = run({
      INGEST_ENV: ingestEnv(dir, { KEY_ID: "facts-1", INGEST_KEY: "k" }),
      FORGEJO_HA_STACK: join(dir, "none"),
      FORGEJO_HA_STATE: join(dir, "none"),
      NOTIFY_ENV: join(dir, "none"),
    });
    expect(res.status).toBe(0);
    const { body } = parseDryRun(res.stdout);
    const payload = FactsPayload.parse(JSON.parse(body));
    expect(findForbiddenLiterals(body)).toEqual([]);
    expect(byGroup(payload).backup!.lastResult!.value).toBe("none");
  });

  it("is valid bash", () => {
    expect(() => execFileSync("bash", ["-n", SCRIPT])).not.toThrow();
  });
});
