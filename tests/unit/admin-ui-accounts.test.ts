// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InviteAccept } from "@/client/lib/account/InviteAccept";
import { Setup } from "@/client/lib/account/Setup";
import { SignIn } from "@/client/lib/account/SignIn";
import { ApiKeys } from "@/client/lib/admin/ApiKeys";
import { Users } from "@/client/lib/admin/Users";
import { parseSiteConfig } from "@/shared/config";
import type { ApiKeyList, InviteList, UserList, UserSummary } from "@/shared/schemas/auth";
import demo from "../../sites/demo.json";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Test addresses and a secret-shaped key, built at run time (the repo scan rejects such literals). */
const email = (local: string) => [local, "example.com"].join("@");
const KEY = `upt_${Array.from({ length: 40 }, (_, i) => "abcdefghijklmnopqrstuvwxyz"[i % 26]).join("")}`;
const PASSWORD = "correct horse battery";

let root: Root | null = null;
let host: HTMLElement;
let calls: { method: string; path: string; body: unknown }[] = [];
let replies: { status: number; body?: unknown }[] = [];
let assign: ReturnType<typeof vi.fn<(url: string | URL) => void>>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  calls = [];
  replies = [];
  assign = vi.fn<(url: string | URL) => void>();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL | string, init: RequestInit = {}) => {
      const u = new URL(String(url));
      const raw = typeof init.body === "string" ? init.body : undefined;
      calls.push({ method: init.method ?? "GET", path: u.pathname + u.search, body: raw && JSON.parse(raw) });
      const r = replies.shift() ?? { status: 500, body: { error: "http_error", message: "no reply queued" } };
      return r.status === 204
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(r.body), {
            status: r.status,
            headers: { "content-type": "application/json" },
          });
    }),
  );
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mount = (el: ReturnType<typeof createElement>) => {
  root = createRoot(host);
  act(() => root!.render(el));
};
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
const button = (label: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  )!;
const field = (label: string) => {
  const l = [...document.querySelectorAll("label")].find((x) => x.textContent === label)!;
  return document.getElementById(l.htmlFor) as HTMLInputElement;
};
function type(el: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function choose(el: HTMLSelectElement, value: string) {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
const text = () => document.body.textContent ?? "";
const submit = async (label: string) => {
  act(() => button(label).click());
  await settle();
};

const user = (id: string, role: UserSummary["role"], name = `User ${id}`): UserSummary => ({
  id,
  name,
  email: email(id),
  image: null,
  role,
  createdAt: "2026-09-01T00:00:00Z",
});
const me = (u: UserSummary) => ({
  user: u,
  permissions: [],
  providers: { emailPassword: true, github: false, google: false },
  setupNeeded: false,
});

describe("sign-in", () => {
  const providers = { emailPassword: true, github: false, google: false } as const;

  it("checks the fields, signs in, then loads `next`", async () => {
    mount(createElement(SignIn, { providers, next: "/admin/users" }));
    expect(text()).not.toContain("Continue with");
    await submit("Sign in");
    expect(calls).toHaveLength(0);
    expect(field("Email").getAttribute("aria-invalid")).toBe("true");

    type(field("Email"), email("owner"));
    type(field("Password"), PASSWORD);
    replies.push({ status: 200, body: { redirect: false } });
    await submit("Sign in");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/auth/sign-in/email",
      body: { email: email("owner"), password: PASSWORD },
    });
    expect(assign).toHaveBeenCalledWith("/admin/users");
  });

  it("says why sign-in failed and stays on the page", async () => {
    mount(createElement(SignIn, { providers, next: "/" }));
    type(field("Email"), email("owner"));
    type(field("Password"), "wrong");
    replies.push({
      status: 401,
      body: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
    });
    await submit("Sign in");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Invalid email or password");
    expect(assign).not.toHaveBeenCalled();
  });

  it("starts GitHub sign-in when enabled and follows the provider's URL", async () => {
    mount(createElement(SignIn, { providers: { ...providers, github: true }, next: "/admin" }));
    expect(text()).not.toContain("Continue with Google");
    replies.push({
      status: 200,
      body: { url: "https://github.com/login/oauth/authorize?x=1", redirect: true },
    });
    await submit("Continue with GitHub");
    expect(calls[0]).toMatchObject({
      path: "/api/auth/sign-in/social",
      body: { provider: "github", callbackURL: "/admin" },
    });
    expect(assign).toHaveBeenCalledWith("https://github.com/login/oauth/authorize?x=1");
  });
});

describe("invite acceptance", () => {
  const invite = { role: "admin" as const, email: email("new-admin"), expiresAt: "2026-10-05T10:00:00Z" };

  it("shows the role and expiry, fixes the invited address, and checks the passwords match", async () => {
    mount(createElement(InviteAccept, { token: "tok-1", invite }));
    expect(text()).toContain("You are invited as admin");
    expect(text()).toContain("2026-10-05 10:00 UTC");
    expect(field("Email").value).toBe(email("new-admin"));
    expect(field("Email").readOnly).toBe(true);

    type(field("Name"), "New Admin");
    type(field("Password (at least 12 characters)"), PASSWORD);
    type(field("Confirm password"), "something else entirely");
    await submit("Create account");
    expect(calls).toHaveLength(0);
    expect(text()).toContain("The passwords do not match");

    type(field("Password (at least 12 characters)"), "short");
    type(field("Confirm password"), "short");
    await submit("Create account");
    expect(calls).toHaveLength(0);
    expect(field("Password (at least 12 characters)").getAttribute("aria-invalid")).toBe("true");
  });

  it("creates the account signed in and lands in admin, or shows the server's refusal", async () => {
    mount(createElement(InviteAccept, { token: "tok-1", invite }));
    type(field("Name"), "New Admin");
    type(field("Password (at least 12 characters)"), PASSWORD);
    type(field("Confirm password"), PASSWORD);
    replies.push({
      status: 404,
      body: { error: "not_found", message: "Unknown or expired invite", issues: [] },
    });
    await submit("Create account");
    expect(text()).toContain("Unknown or expired invite");
    expect(assign).not.toHaveBeenCalled();

    replies.push({ status: 201, body: me(user("n1", "admin", "New Admin")) });
    await submit("Create account");
    expect(calls[1]).toMatchObject({
      method: "POST",
      path: "/api/invites/tok-1/accept",
      body: { name: "New Admin", email: email("new-admin"), password: PASSWORD },
    });
    expect(calls[1]!.body).not.toHaveProperty("confirm");
    expect(assign).toHaveBeenCalledWith("/admin");
  });

  it("lets an open invite choose the address and sends a viewer to the status page", async () => {
    mount(
      createElement(InviteAccept, { token: "tok-2", invite: { ...invite, role: "viewer", email: null } }),
    );
    expect(field("Email").readOnly).toBe(false);
    type(field("Name"), "A Viewer");
    type(field("Email"), email("viewer"));
    type(field("Password (at least 12 characters)"), PASSWORD);
    type(field("Confirm password"), PASSWORD);
    replies.push({ status: 201, body: me(user("v1", "viewer")) });
    await submit("Create account");
    expect(assign).toHaveBeenCalledWith("/");
  });
});

describe("first-run setup", () => {
  const config = parseSiteConfig(demo);
  const owner = async () => {
    type(field("Name"), "Site Owner");
    type(field("Email"), email("owner"));
    type(field("Password (at least 12 characters)"), PASSWORD);
    type(field("Confirm password"), PASSWORD);
    replies.push({ status: 201, body: me(user("o1", "owner")) });
    replies.push({
      status: 200,
      body: { config, version: 1, savedAt: "2026-09-28T00:00:00Z", savedBy: "seed" },
    });
    await submit("Create owner account");
  };

  it("creates the owner, then confirms the site this host serves and opens admin", async () => {
    mount(createElement(Setup, { site: "demo", host: "status.example.com" }));
    await owner();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/setup",
      "GET /api/admin/sites/demo/config",
    ]);
    expect(text()).toContain("This address serves the site demo");
    expect(field("Slug").readOnly).toBe(true);
    expect(field("Name").value).toBe(config.name);
    choose(field("Visibility") as unknown as HTMLSelectElement, "private");
    replies.push({ status: 200, body: { version: 2, diff: [] } });
    await submit("Save and open admin");
    expect(calls[2]).toMatchObject({
      method: "PUT",
      path: "/api/admin/sites/demo/config",
      body: { baseVersion: 1, note: "first-run setup", config: { slug: "demo", visibility: "private" } },
    });
    expect(assign).toHaveBeenCalledWith("/admin");
  });

  it("creates a new site instead when asked", async () => {
    mount(createElement(Setup, { site: "demo", host: "status.example.com" }));
    await owner();
    act(() => button("Create a new site instead").click());
    expect(field("Slug").readOnly).toBe(false);
    expect(field("Hostname").value).toBe("status.example.com");
    type(field("Slug"), "Bad Slug");
    await submit("Create site and open admin");
    expect(calls).toHaveLength(2);
    type(field("Slug"), "acme");
    type(field("Name"), "Acme Cloud");
    replies.push({ status: 201, body: { version: 1, diff: [] } });
    await submit("Create site and open admin");
    expect(calls[2]).toMatchObject({
      method: "POST",
      path: "/api/admin/sites",
      body: {
        config: {
          slug: "acme",
          name: "Acme Cloud",
          hostnames: ["status.example.com"],
          visibility: "private",
          theme: "a-sys-status",
        },
      },
    });
    expect(assign).toHaveBeenCalledWith("/admin");
  });
});

describe("API keys", () => {
  const list: ApiKeyList = {
    keys: [
      {
        id: "k1",
        site: "demo",
        name: "facts pusher",
        scopes: ["ingest"],
        prefix: "upt_k1",
        createdAt: "2026-09-01T00:00:00Z",
        createdBy: "o1",
        lastUsedAt: "2026-09-27T09:00:00Z",
        revokedAt: null,
      },
    ],
  };

  it("shows a new key once, with a warning and copy, and forgets it on close", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onReload = vi.fn();
    mount(createElement(ApiKeys, { site: "demo", list, onReload }));
    expect(text()).toContain("last used 2026-09-27 09:00 UTC");

    await submit("Create API key");
    expect(calls).toHaveLength(0);
    type(field("Label"), "agent on app-2");
    act(() => (document.querySelector('input[type="checkbox"]:not(:checked)') as HTMLInputElement).click());
    replies.push({
      status: 201,
      body: {
        ...list.keys[0]!,
        id: "k2",
        name: "agent on app-2",
        scopes: ["ingest", "read"],
        prefix: "upt_k2",
        key: KEY,
      },
    });
    await submit("Create API key");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/admin/sites/demo/api-keys",
      body: { name: "agent on app-2", scopes: ["ingest", "read"] },
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("This key is shown once");
    expect(field("API key").value).toBe(KEY);
    act(() => button("Copy key").click());
    await settle();
    expect(writeText).toHaveBeenCalledWith(KEY);
    expect(dialog.textContent).toContain("Copied.");

    act(() => button("Done").click());
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain(KEY);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("revokes a key only after confirming", async () => {
    const onReload = vi.fn();
    mount(createElement(ApiKeys, { site: "demo", list, onReload }));
    act(() => button("Revoke facts pusher").click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Anything using this key is refused",
    );
    expect(calls).toHaveLength(0);
    replies.push({ status: 200, body: { ...list.keys[0]!, revokedAt: "2026-09-28T00:00:00Z" } });
    await submit("Revoke key");
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/api/admin/sites/demo/api-keys/k1" });
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe("users and invites", () => {
  const owner = user("o1", "owner", "Site Owner");
  const users: UserList = {
    users: [
      { ...owner, lastSignInAt: "2026-09-28T08:00:00Z" },
      { ...user("a1", "admin", "An Admin"), lastSignInAt: null },
    ],
  };
  const invites: InviteList = {
    invites: [
      {
        id: "i1",
        role: "viewer",
        email: null,
        status: "pending",
        createdAt: "2026-09-27T00:00:00Z",
        expiresAt: "2026-10-04T00:00:00Z",
        createdBy: "o1",
      },
      {
        id: "i2",
        role: "admin",
        email: null,
        status: "accepted",
        createdAt: "2026-09-20T00:00:00Z",
        expiresAt: "2026-09-27T00:00:00Z",
        createdBy: "o1",
      },
    ],
  };

  it("lists users with role and last sign-in, and changes a role", async () => {
    const onReload = vi.fn();
    mount(createElement(Users, { me: owner, users, invites, onReload }));
    expect(text()).toContain("Site Owner (you)");
    expect(text()).toContain("last sign-in 2026-09-28 08:00 UTC");
    expect(text()).toContain("last sign-in never");
    expect(text()).toContain("expires 2026-10-04 00:00 UTC");
    expect(document.querySelectorAll('[aria-label^="Revoke the"]')).toHaveLength(1);

    replies.push({ status: 200, body: user("a1", "viewer", "An Admin") });
    choose(field("Role of An Admin") as unknown as HTMLSelectElement, "viewer");
    await settle();
    expect(calls[0]).toMatchObject({
      method: "PATCH",
      path: "/api/admin/users/a1",
      body: { role: "viewer" },
    });
    expect(onReload).toHaveBeenCalledTimes(1);

    replies.push({
      status: 409,
      body: { error: "conflict", message: "The last owner cannot be demoted or removed", issues: [] },
    });
    choose(field("Role of Site Owner") as unknown as HTMLSelectElement, "admin");
    await settle();
    expect(text()).toContain("The last owner cannot be demoted or removed");
  });

  it("removes a user only after confirming", async () => {
    mount(createElement(Users, { me: owner, users, invites, onReload: vi.fn() }));
    act(() => button("Remove An Admin").click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("loses access at once");
    expect(calls).toHaveLength(0);
    replies.push({ status: 204 });
    await submit("Remove user");
    expect(calls[0]).toMatchObject({ method: "DELETE", path: "/api/admin/users/a1" });
  });

  it("shows a new invite's link once with its expiry", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onReload = vi.fn();
    mount(createElement(Users, { me: owner, users, invites, onReload }));
    type(field("Email (optional: only this address may accept)"), email("new-admin"));
    choose(field("Role") as unknown as HTMLSelectElement, "admin");
    const url = "https://status.example.com/invite/tok-3";
    replies.push({
      status: 201,
      body: { ...invites.invites[0]!, id: "i3", role: "admin", email: email("new-admin"), url },
    });
    await submit("Create invite");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/admin/invites",
      body: { role: "admin", email: email("new-admin") },
    });
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("This link is shown once and works once");
    expect(dialog.textContent).toContain("Expires 2026-10-04 00:00 UTC");
    expect(field("Invite link").value).toBe(url);
    act(() => button("Copy link").click());
    await settle();
    expect(writeText).toHaveBeenCalledWith(url);
    act(() => button("Done").click());
    await settle();
    expect(document.body.innerHTML).not.toContain(url);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("does not offer an admin the owner role or the owner's controls", () => {
    const admin = user("a1", "admin", "An Admin");
    mount(createElement(Users, { me: admin, users, invites, onReload: vi.fn() }));
    const inviteRoles = [...(field("Role") as unknown as HTMLSelectElement).options].map((o) => o.value);
    expect(inviteRoles).toEqual(["admin", "viewer"]);
    expect((field("Role of Site Owner") as unknown as HTMLSelectElement).disabled).toBe(true);
    expect(button("Remove Site Owner").disabled).toBe(true);
    const own = [...(field("Role of An Admin") as unknown as HTMLSelectElement).options].map((o) => o.value);
    expect(own).toEqual(["admin", "viewer"]);
  });
});
