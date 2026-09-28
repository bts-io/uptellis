/**
 * Accounts end to end over D1: first-run setup (and that it closes), sign-in and sign-out, invites (role,
 * one use, expiry, a bound address), role changes and removal (only an owner touches an owner, the last owner
 * stays), permissions per admin route, and the JWT plugin's token and JWKS. The cases build on each other
 * in order: one database for the whole file.
 */
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Role } from "@/shared/auth";
import {
  AuthErrorResponse,
  InviteInfo,
  InviteList,
  IssuedInvite,
  Me,
  SetupStatus,
  UserList,
  UserSummary,
} from "@/shared/schemas/auth";
import { createDb, schema } from "@/worker/db";
import { resetConfigCache } from "@/worker/engine/config-store";
import { admin, adminEnv, handle, json, OWNER, send, sessionCookie, signIn, testEmail } from "./admin-app";

const db = createDb(adminEnv.DB);

const me = async (cookie?: string) =>
  Me.parse(await json(await handle("/api/me", cookie ? { headers: { cookie } } : {})));

/** Creates an invite as `cookie` and accepts it; the new user's session cookie and id. */
async function invited(cookie: string, role: Role, local: string) {
  const res = await admin(cookie).post("/invites", { role });
  expect(res.status).toBe(201);
  const invite = IssuedInvite.parse(await json(res));
  const token = invite.url.split("/").pop()!;
  const accepted = await send(`/api/invites/${token}/accept`, {
    name: local,
    email: testEmail(local),
    password: `${local}-password-long`,
  });
  expect(accepted.status).toBe(201);
  const body = Me.parse(await json(accepted));
  return { cookie: sessionCookie(accepted)!, id: body.user!.id, token };
}

let owner = "";

beforeAll(() => resetConfigCache());

describe("first-run setup", () => {
  it("is needed while there is no account, and anonymous has no permissions", async () => {
    expect(SetupStatus.parse(await json(await handle("/api/setup")))).toEqual({ needed: true });
    const anon = await me();
    expect(anon).toMatchObject({ user: null, permissions: [], setupNeeded: true });
    expect(anon.providers).toEqual({ emailPassword: true, github: false, google: false });
  });

  it("rejects a weak password and a cross-site post", async () => {
    const weak = await send("/api/setup", { ...OWNER, password: "short" });
    expect(weak.status).toBe(400);
    expect(AuthErrorResponse.parse(await json(weak)).issues.map((i) => i.path)).toEqual(["password"]);
    const cross = await send("/api/setup", OWNER, { headers: { origin: "https://evil.example" } });
    expect(cross.status).toBe(403);
    expect(SetupStatus.parse(await json(await handle("/api/setup")))).toEqual({ needed: true });
  });

  it("creates the owner, signed in with a secure session cookie", async () => {
    const res = await send("/api/setup", OWNER);
    expect(res.status).toBe(201);
    const body = Me.parse(await json(res));
    expect(body.user).toMatchObject({ name: OWNER.name, email: OWNER.email, role: "owner" });
    expect(body.permissions).toEqual([
      "page.view",
      "config.edit",
      "sources.manage",
      "users.manage",
      "instance.manage",
    ]);
    const set = res.headers.getSetCookie().find((c) => c.startsWith("__Secure-uptellis.session_token="))!;
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/Secure/i);
    expect(set).toMatch(/SameSite=Lax/i);
    owner = sessionCookie(res)!;
    expect((await me(owner)).user?.role).toBe("owner");
  });

  it("is closed afterwards, and public sign-up does not exist", async () => {
    expect(SetupStatus.parse(await json(await handle("/api/setup")))).toEqual({ needed: false });
    const again = await send("/api/setup", { ...OWNER, email: testEmail("second") });
    expect(again.status).toBe(409);
    const signUp = await send("/api/auth/sign-up/email", {
      name: "Intruder",
      email: testEmail("intruder"),
      password: "intruder-password",
    });
    expect(signUp.status).toBe(404);
    const users = await db.select().from(schema.users);
    expect(users.map((u) => [u.email, u.role])).toEqual([[OWNER.email, "owner"]]);
    // Only a hash is stored.
    const [account] = await db.select().from(schema.accounts);
    expect(account!.password).not.toContain(OWNER.password);
  });
});

describe("sign-in", () => {
  it("signs in with the right password only, and signs out", async () => {
    expect(await signIn(OWNER.email, "not-the-password")).toBeNull();
    expect(await signIn(testEmail("nobody"), OWNER.password)).toBeNull();
    const cookie = await signIn(OWNER.email, OWNER.password);
    expect(cookie).not.toBeNull();
    expect((await me(cookie!)).user?.email).toBe(OWNER.email);

    const out = await handle("/api/auth/sign-out", {
      method: "POST",
      headers: { cookie: cookie!, origin: "https://worker.example.net" },
    });
    expect(out.status).toBe(200);
    expect((await me(cookie!)).user).toBeNull();
  });

  it("treats a forged session cookie as signed out", async () => {
    expect((await me("__Secure-uptellis.session_token=forged.value")).user).toBeNull();
    expect(
      (await handle("/api/admin/users", { headers: { cookie: "__Secure-uptellis.session_token=x" } })).status,
    ).toBe(401);
  });
});

describe("invites", () => {
  it("need users.manage, and only an owner may invite an owner", async () => {
    expect((await handle("/api/admin/invites")).status).toBe(401);
    const adminUser = await invited(owner, "admin", "first-admin");
    expect((await me(adminUser.cookie)).user?.role).toBe("admin");
    const ownerInvite = await admin(adminUser.cookie).post("/invites", { role: "owner" });
    expect(ownerInvite.status).toBe(403);
    expect((await admin(adminUser.cookie).post("/invites", { role: "viewer" })).status).toBe(201);
    const viewer = await invited(owner, "viewer", "first-viewer");
    expect((await admin(viewer.cookie).post("/invites", { role: "viewer" })).status).toBe(403);
    expect((await admin(viewer.cookie).get("/invites")).status).toBe(403);
  });

  it("show their role, create the account with it, and work once", async () => {
    const res = await admin(owner).post("/invites", { role: "admin" });
    const invite = IssuedInvite.parse(await json(res));
    expect(invite).toMatchObject({ role: "admin", email: null, status: "pending" });
    expect(invite.url).toMatch(/^https:\/\/worker\.example\.net\/invite\/[A-Za-z0-9_-]{43}$/);
    expect(Date.parse(invite.expiresAt) - Date.parse(invite.createdAt)).toBe(7 * 24 * 3600 * 1000);
    const token = invite.url.split("/").pop()!;

    const info = await handle(`/api/invites/${token}`);
    expect(InviteInfo.parse(await json(info))).toEqual({
      role: "admin",
      email: null,
      expiresAt: invite.expiresAt,
    });

    const body = {
      name: "Second Admin",
      email: testEmail("second-admin"),
      password: "second-admin-password",
    };
    const accepted = await send(`/api/invites/${token}/accept`, body);
    expect(accepted.status).toBe(201);
    expect(Me.parse(await json(accepted)).user?.role).toBe("admin");
    expect(sessionCookie(accepted)).not.toBeNull();

    expect((await handle(`/api/invites/${token}`)).status).toBe(404);
    const replay = await send(`/api/invites/${token}/accept`, { ...body, email: testEmail("replay") });
    expect(replay.status).toBe(404);

    const list = InviteList.parse(await json(await admin(owner).get("/invites")));
    expect(list.invites.find((i) => i.id === invite.id)?.status).toBe("accepted");
    // Only the hash of the token is stored.
    const rows = await db.select().from(schema.invites);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("expire after 7 days", async () => {
    const invite = IssuedInvite.parse(await json(await admin(owner).post("/invites", { role: "viewer" })));
    const token = invite.url.split("/").pop()!;
    await db
      .update(schema.invites)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(schema.invites.id, invite.id));
    expect((await handle(`/api/invites/${token}`)).status).toBe(404);
    const late = await send(`/api/invites/${token}/accept`, {
      name: "Late",
      email: testEmail("late"),
      password: "late-password-long",
    });
    expect(late.status).toBe(404);
    const list = InviteList.parse(await json(await admin(owner).get("/invites")));
    expect(list.invites.find((i) => i.id === invite.id)?.status).toBe("expired");
  });

  it("bound to an address accept only that address, and an existing address is refused", async () => {
    const bound = testEmail("bound");
    const invite = IssuedInvite.parse(
      await json(await admin(owner).post("/invites", { role: "viewer", email: bound })),
    );
    const token = invite.url.split("/").pop()!;
    const other = await send(`/api/invites/${token}/accept`, {
      name: "Other",
      email: testEmail("other"),
      password: "other-password-long",
    });
    expect(other.status).toBe(400);
    const taken = await admin(owner).post("/invites", { role: "viewer" });
    const takenToken = IssuedInvite.parse(await json(taken))
      .url.split("/")
      .pop()!;
    const dup = await send(`/api/invites/${takenToken}/accept`, {
      name: "Dup",
      email: OWNER.email,
      password: "dup-password-long",
    });
    expect(dup.status).toBe(409);
    // Neither refusal used up its invite.
    expect((await handle(`/api/invites/${token}`)).status).toBe(200);
    expect((await handle(`/api/invites/${takenToken}`)).status).toBe(200);
    expect(
      (
        await send(`/api/invites/${token}/accept`, {
          name: "Bound",
          email: bound,
          password: "bound-password-long",
        })
      ).status,
    ).toBe(201);
  });

  it("can be deleted", async () => {
    const invite = IssuedInvite.parse(await json(await admin(owner).post("/invites", { role: "viewer" })));
    expect((await admin(owner).delete(`/invites/${invite.id}`)).status).toBe(204);
    expect((await handle(`/api/invites/${invite.url.split("/").pop()}`)).status).toBe(404);
    expect((await admin(owner).delete(`/invites/${invite.id}`)).status).toBe(404);
  });
});

describe("users and roles", () => {
  it("lists users without secrets", async () => {
    const res = await admin(owner).get("/users");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("password");
    const { users } = UserList.parse(JSON.parse(text));
    expect(users[0]).toMatchObject({ email: OWNER.email, role: "owner" });
  });

  it("never demotes or removes the last owner", async () => {
    const ownerId = (await me(owner)).user!.id;
    const demote = await admin(owner).patch(`/users/${ownerId}`, { role: "admin" });
    expect(demote.status).toBe(409);
    expect(AuthErrorResponse.parse(await json(demote)).error).toBe("conflict");
    expect((await admin(owner).delete(`/users/${ownerId}`)).status).toBe(409);
    expect((await me(owner)).user?.role).toBe("owner");
  });

  it("lets only an owner change an owner, and a second owner makes the first removable", async () => {
    const helper = await invited(owner, "admin", "role-admin");
    const ownerId = (await me(owner)).user!.id;
    expect((await admin(helper.cookie).patch(`/users/${ownerId}`, { role: "viewer" })).status).toBe(403);
    expect((await admin(helper.cookie).patch(`/users/${helper.id}`, { role: "owner" })).status).toBe(403);

    const promoted = await admin(owner).patch(`/users/${helper.id}`, { role: "owner" });
    expect(promoted.status).toBe(200);
    expect(UserSummary.parse(await json(promoted)).role).toBe("owner");
    // Two owners: either may be demoted now, and the change applies to the live session at once.
    const back = await admin(owner).patch(`/users/${helper.id}`, { role: "viewer" });
    expect(back.status).toBe(200);
    expect((await me(helper.cookie)).permissions).toEqual(["page.view"]);
    expect((await admin(helper.cookie).get("/users")).status).toBe(403);
  });

  it("removes a user with its sessions", async () => {
    const gone = await invited(owner, "viewer", "to-remove");
    expect((await me(gone.cookie)).user).not.toBeNull();
    expect((await admin(owner).delete(`/users/${gone.id}`)).status).toBe(204);
    expect((await me(gone.cookie)).user).toBeNull();
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, gone.id))).toEqual([]);
    expect((await admin(owner).delete(`/users/${gone.id}`)).status).toBe(404);
    expect((await admin(owner).patch("/users/nobody", { role: "viewer" })).status).toBe(404);
  });

  it("validates the role", async () => {
    const res = await admin(owner).patch(`/users/${(await me(owner)).user!.id}`, { role: "root" });
    expect(res.status).toBe(400);
  });
});

describe("permissions per admin route", () => {
  const routes: [string, string][] = [
    ["GET", "/sites/demo/config"],
    ["GET", "/sites/demo/config/revisions"],
    ["GET", "/sites/demo/config/export"],
    ["GET", "/sites/demo/sources"],
    ["GET", "/sites/demo/api-keys"],
    ["GET", "/users"],
    ["GET", "/invites"],
  ];
  it("answers 401 signed out, 403 without the permission, 200 with it", async () => {
    const viewer = await invited(owner, "viewer", "perm-viewer");
    const adminUser = await invited(owner, "admin", "perm-admin");
    for (const [, path] of routes) {
      expect((await handle(`/api/admin${path}`)).status, `anon ${path}`).toBe(401);
      expect((await admin(viewer.cookie).get(path)).status, `viewer ${path}`).toBe(403);
      expect((await admin(adminUser.cookie).get(path)).status, `admin ${path}`).toBe(200);
      expect((await admin(owner).get(path)).status, `owner ${path}`).toBe(200);
    }
    const put = await admin(viewer.cookie).put("/sites/demo/config", { config: {}, baseVersion: 1 });
    expect(put.status).toBe(403);
    const notify = await admin(viewer.cookie).post("/notify/test?kind=stale");
    expect(notify.status).toBe(403);
  });

  it("refuses cross-site admin writes even with a session", async () => {
    const res = await handle("/api/admin/invites", {
      method: "POST",
      headers: { cookie: owner, origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ role: "viewer" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("JWT and JWKS", () => {
  it("serves the JWKS, and a session's JWT verifies against it", async () => {
    const tokenRes = await handle("/api/auth/token", { headers: { cookie: owner } });
    expect(tokenRes.status).toBe(200);
    const { token } = (await tokenRes.json()) as { token: string };
    const jwksRes = await handle("/api/auth/jwks");
    expect(jwksRes.status).toBe(200);
    const { keys } = (await jwksRes.json()) as { keys: (JsonWebKey & { kid: string; alg?: string })[] };
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k).not.toHaveProperty("d");

    const [h, p, s] = token.split(".") as [string, string, string];
    const decode = (part: string) => JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
    const header = decode(h) as { kid: string; alg: string };
    const payload = decode(p) as {
      sub: string;
      role: string;
      iss: string;
      aud: string;
      exp: number;
      iat: number;
    };
    expect(header.alg).toBe("EdDSA");
    expect(payload).toMatchObject({
      sub: (await me(owner)).user!.id,
      role: "owner",
      iss: "https://worker.example.net",
    });
    expect(payload.exp - payload.iat).toBe(15 * 60);

    const jwk = keys.find((k) => k.kid === header.kid)!;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["verify"]);
    const sig = Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      sig,
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it("issues no token without a session", async () => {
    expect((await handle("/api/auth/token")).status).toBe(401);
  });
});
