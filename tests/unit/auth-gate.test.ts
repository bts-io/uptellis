import { afterEach, describe, expect, it, vi } from "vitest";
import { can, type Principal } from "@/shared/auth";
import { type AuthPlatform, authProviders, baseUrl } from "@/worker/auth/instance";
import { LEGACY_SECRETS, warnLegacyIngestKeys, warnLegacyKeys } from "@/worker/auth/legacy";
import { hashToken, randomId, randomToken } from "@/worker/auth/tokens";
import { isAdminPath, pageGate } from "@/worker/middleware/auth-gate";

const req = (path: string) => new Request(`https://status.example${path}`);
const anon: Principal = { kind: "anonymous" };
const viewer: Principal = { kind: "user", userId: "u1", role: "viewer" };
const adminUser: Principal = { kind: "user", userId: "u2", role: "admin" };
const reader: Principal = { kind: "apiKey", keyId: "k1", site: "demo", scopes: ["read", "ingest"] };
const noSetup = async () => false;

describe("page gate", () => {
  it("lets every non-admin page through, whoever asks", async () => {
    for (const path of ["/", "/?theme=c-session", "/sign-in", "/setup", "/invite/abc", "/administrator"]) {
      for (const p of [anon, viewer, reader]) expect(await pageGate(req(path), p, noSetup), path).toBeNull();
    }
  });

  it("sends a signed-out visitor of the admin UI to sign in, keeping the path, or to setup", async () => {
    const res = (await pageGate(req("/admin/sources?tab=keys"), anon, noSetup))!;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(
      `/sign-in?next=${encodeURIComponent("/admin/sources?tab=keys")}`,
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    const first = (await pageGate(req("/admin"), anon, async () => true))!;
    expect(first.headers.get("location")).toBe("/setup");
  });

  it("answers 404 to a viewer and an API key, and lets an admin in", async () => {
    for (const p of [viewer, reader]) {
      const res = (await pageGate(req("/admin"), p, noSetup))!;
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("Not found");
    }
    expect(await pageGate(req("/admin/users"), adminUser, noSetup)).toBeNull();
  });

  it("matches admin paths exactly", () => {
    for (const p of ["/admin", "/admin/", "/admin/x", "/api/admin/users"])
      expect(isAdminPath(p), p).toBe(true);
    for (const p of ["/administrator", "/x/admin", "/api/adminx"]) expect(isAdminPath(p), p).toBe(false);
  });
});

describe("can()", () => {
  it("opens public sites to everyone and private ones to users and read keys of the site", () => {
    const pub = { slug: "demo", visibility: "public" } as const;
    const priv = { slug: "demo", visibility: "private" } as const;
    expect(can(anon, "page.view", pub)).toBe(true);
    expect(can(anon, "page.view", priv)).toBe(false);
    expect(can(viewer, "page.view", priv)).toBe(true);
    expect(can(reader, "page.view", priv)).toBe(true);
    expect(can(reader, "page.view", { slug: "other", visibility: "private" })).toBe(false);
    expect(can(reader, "config.edit")).toBe(false);
  });
});

describe("tokens", () => {
  it("are random, and stored as a hex SHA-256", async () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(randomToken());
    expect(randomId()).toMatch(/^[a-z0-9]{12}$/);
    const hash = await hashToken("abc");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken("abc")).toBe(hash);
    expect(await hashToken("abd")).not.toBe(hash);
  });
});

describe("legacy key notice", () => {
  afterEach(() => vi.restoreAllMocks());

  it("tells once to open /setup when an old key is still set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env: Record<string, string> = { VIEWER_KEY: "old", ADMIN_KEY: "old" };
    warnLegacyKeys((name) => env[name]);
    warnLegacyKeys((name) => env[name]);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(warn.mock.calls[0]![0])) as {
      evt: string;
      set: string[];
      message: string;
    };
    expect(line.evt).toBe("legacy_keys");
    expect(line.set).toEqual(["VIEWER_KEY", "ADMIN_KEY"]);
    expect(line.message).toContain("/setup");
    expect(LEGACY_SECRETS).toContain("VIEWER_COOKIE_SECRET");
  });

  it("names leftover INGEST_KEY_* secrets once, never their values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const names = ["SITE_DEFAULT", "INGEST_KEY_FACTS_1", "INGEST_KEY_COLLECTOR_1_NEXT", "INGEST_KEY_"];
    warnLegacyIngestKeys(names);
    warnLegacyIngestKeys(names);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(warn.mock.calls[0]![0])) as {
      evt: string;
      set: string[];
      message: string;
    };
    expect(line.evt).toBe("legacy_keys");
    expect(line.set).toEqual(["INGEST_KEY_COLLECTOR_1_NEXT", "INGEST_KEY_FACTS_1"]);
    expect(line.message).toContain("no longer read");
    expect(line.message).toContain("Admin > Sources");
  });
});

describe("sign-in methods", () => {
  const platform = (values: Record<string, string>) =>
    ({ setting: (n: string) => values[n], secret: (n: string) => values[n] }) as unknown as AuthPlatform;

  it("offer GitHub and Google only when both the client id and the secret are set", () => {
    expect(authProviders(platform({}))).toEqual({ emailPassword: true, github: false, google: false });
    expect(authProviders(platform({ GITHUB_CLIENT_ID: "id" }))).toMatchObject({ github: false });
    expect(authProviders(platform({ GOOGLE_CLIENT_SECRET: "s" }))).toMatchObject({ google: false });
    expect(
      authProviders(platform({ GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "s", GOOGLE_CLIENT_ID: "id" })),
    ).toEqual({ emailPassword: true, github: true, google: false });
  });

  it("take the base URL from PUBLIC_URL, else the request", () => {
    expect(baseUrl(platform({ PUBLIC_URL: "https://status.example.com/" }), "http://localhost:3000/x")).toBe(
      "https://status.example.com",
    );
    expect(baseUrl(platform({}), "http://localhost:3000/x")).toBe("http://localhost:3000");
  });
});
