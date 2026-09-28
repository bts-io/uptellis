import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "../src/config";
import { KEY } from "./fake-uptellis";
import { cleanup, tempDir } from "./helpers";

afterAll(cleanup);

const dir = tempDir();
const file = (name: string, text: string, mode = 0o600) => {
  const p = join(dir, name);
  writeFileSync(p, text);
  chmodSync(p, mode);
  return p;
};
const base = () => ({
  UPTELLIS_URL: "https://status.example.org/",
  UPTELLIS_RUNNER: "office-1",
  UPTELLIS_API_KEY: KEY,
});

describe("loadConfig", () => {
  it("reads a minimal environment with defaults", () => {
    const c = loadConfig(base());
    expect(c).toEqual({
      baseUrl: "https://status.example.org",
      apiKey: KEY,
      runner: "office-1",
      dataDir: "/var/lib/uptellis-agent",
      concurrency: 8,
      livenessFile: null,
    });
  });

  it("keeps a base path and reads the key from a mode 600 file", () => {
    const c = loadConfig({
      ...base(),
      UPTELLIS_URL: "https://example.org/status/",
      UPTELLIS_API_KEY: undefined,
      UPTELLIS_API_KEY_FILE: file("key", `${KEY}\n`),
      UPTELLIS_DATA_DIR: "/data",
      UPTELLIS_CONCURRENCY: "3",
    });
    expect(c.baseUrl).toBe("https://example.org/status");
    expect(c.apiKey).toBe(KEY);
    expect(c.dataDir).toBe("/data");
    expect(c.concurrency).toBe(3);
  });

  it("refuses a key file others can read", () => {
    expect(() =>
      loadConfig({ ...base(), UPTELLIS_API_KEY: undefined, UPTELLIS_API_KEY_FILE: file("k2", KEY, 0o644) }),
    ).toThrow(/readable by group or others/);
  });

  it("never puts the key in an error", () => {
    const bad = `upt_${"x".repeat(20)}`;
    try {
      loadConfig({ ...base(), UPTELLIS_API_KEY: bad });
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as Error).message).toContain("not an Uptellis API key");
      expect((e as Error).message).not.toContain(bad);
    }
  });

  it("requires https except for localhost or with UPTELLIS_ALLOW_HTTP", () => {
    expect(() => loadConfig({ ...base(), UPTELLIS_URL: "http://status.example.org" })).toThrow(/https/);
    expect(loadConfig({ ...base(), UPTELLIS_URL: "http://localhost:8787" }).baseUrl).toBe(
      "http://localhost:8787",
    );
    expect(
      loadConfig({ ...base(), UPTELLIS_URL: "http://status.example.org", UPTELLIS_ALLOW_HTTP: "1" }).baseUrl,
    ).toBe("http://status.example.org");
  });

  it("validates the runner id and the required variables", () => {
    expect(() => loadConfig({ ...base(), UPTELLIS_RUNNER: "builtin" })).toThrow(/agent id/);
    expect(() => loadConfig({ ...base(), UPTELLIS_RUNNER: "Office 1" })).toThrow(/agent id/);
    expect(() => loadConfig({ ...base(), UPTELLIS_URL: undefined })).toThrow(/UPTELLIS_URL is required/);
    expect(() => loadConfig({ ...base(), UPTELLIS_API_KEY: undefined })).toThrow(/UPTELLIS_API_KEY/);
    expect(() => loadConfig({ ...base(), UPTELLIS_CONCURRENCY: "0" })).toThrow(/UPTELLIS_CONCURRENCY/);
  });
});
