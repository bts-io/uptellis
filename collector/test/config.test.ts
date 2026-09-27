import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";

const dir = mkdtempSync(join(tmpdir(), "collector-config-"));
const file = (name: string, text: string) => {
  const p = join(dir, name);
  writeFileSync(p, text, { mode: 0o600 });
  return p;
};
const base = () => ({
  INGEST_URL: "https://status.example.test/api/ingest/kuma",
  KEY_ID: "collector-1",
  INGEST_KEY_FILE: file("ingest_key", "k".repeat(64)),
  KUMA_PASSWORD_FILE: file("kuma_password", "not-a-real-password"),
  KUMA_USERNAME: "admin",
});

describe("loadConfig: Cloudflare Access is optional", () => {
  it("accepts no Access client id with an empty Access secret file (compose always mounts it)", () => {
    const cfg = loadConfig(
      { ...base(), CF_ACCESS_CLIENT_ID: "", CF_ACCESS_CLIENT_SECRET_FILE: file("cf_empty", "") },
      { needIngest: true },
    );
    expect(cfg.ingest?.accessClientId).toBeNull();
    expect(cfg.ingest?.accessClientSecret).toBeNull();
  });

  it("still requires the secret when a client id is configured", () => {
    expect(() =>
      loadConfig(
        { ...base(), CF_ACCESS_CLIENT_ID: "abc.access", CF_ACCESS_CLIENT_SECRET_FILE: file("cf_empty2", "") },
        { needIngest: true },
      ),
    ).toThrow();
  });

  it("reads the secret when both are configured", () => {
    const cfg = loadConfig(
      {
        ...base(),
        CF_ACCESS_CLIENT_ID: "abc.access",
        CF_ACCESS_CLIENT_SECRET_FILE: file("cf_secret", "s".repeat(40)),
      },
      { needIngest: true },
    );
    expect(cfg.ingest?.accessClientSecret).toBe("s".repeat(40));
  });
});

process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
