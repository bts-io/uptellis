import { describe, expect, it } from "vitest";
import { findForbiddenLiterals } from "@/shared/model";
import { IssuedApiKey, IssuedInvite } from "@/shared/schemas/auth";
import { baseEnv, ownerCookie, send, sessionCookie, testEmail, write } from "./built";
import { seed } from "./seed";

// The account pages server-rendered by the built Worker: first-run setup, sign-in, invite acceptance, the
// account page, and the admin Users and API key sections. The cases run in order: the first ones see an
// instance without accounts, `ownerCookie` then creates the owner.
const text = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
/** The rendered body (asset names in <head> and script payloads look like tokens to the scan). */
const body = (html: string) => html.replace(/<head>.*<\/head>/s, "").replace(/<script\b.*?<\/script>/gs, "");

async function page(path: string, cookie = "") {
  const res = await send(path, { headers: cookie ? { cookie } : {} });
  expect(res.status, path).toBe(200);
  return res.text();
}

describe("before the first account", () => {
  it("serves first-run setup, and sends sign-in, admin and the account page there", async () => {
    const html = await page("/setup");
    const t = text(html);
    expect(html).toMatch(/<title>Set up \| Uptellis<\/title>/);
    for (const label of ["1. Owner account", "2. First site", "Name", "Email", "Confirm password"])
      expect(t, label).toContain(label);
    expect(t).toContain("Create owner account");
    expect(findForbiddenLiterals(body(html))).toEqual([]);

    const signIn = await send("/sign-in");
    expect(signIn.status).toBe(307);
    expect(signIn.headers.get("location")).toBe("/setup");
    expect((await send("/admin")).headers.get("location")).toBe("/setup");
  });
});

describe("with an owner", () => {
  it("answers 404 for setup once an account exists", async () => {
    const cookie = await ownerCookie();
    expect((await send("/setup")).status).toBe(404);
    expect((await send("/setup", { headers: { cookie } })).status).toBe(404);
  });

  it("renders sign-in with email and password only, and GitHub and Google once configured", async () => {
    const t = text(await page("/sign-in?next=%2Fadmin"));
    for (const label of ["Sign in", "Email", "Password", "Ask an owner or admin"])
      expect(t, label).toContain(label);
    expect(t).not.toContain("Continue with");

    const oauth = await send("/sign-in", {}, {
      ...baseEnv,
      GITHUB_CLIENT_ID: "test-github-id",
      GITHUB_CLIENT_SECRET: "test-github-secret",
      GOOGLE_CLIENT_ID: "test-google-id",
      GOOGLE_CLIENT_SECRET: "test-google-secret",
    } as Env);
    const ot = text(await oauth.text());
    expect(ot).toContain("Continue with GitHub");
    expect(ot).toContain("Continue with Google");
  });

  it("sends a signed-in user on to `next`, never off this origin", async () => {
    const cookie = await ownerCookie();
    const to = async (q: string) =>
      (await send(`/sign-in${q}`, { headers: { cookie } })).headers.get("location");
    expect(await to("?next=%2Fadmin%2Fusers")).toBe("/admin/users");
    for (const next of ["//evil.example.com", "https://evil.example.com", "/\\evil.example.com"])
      expect(await to(`?next=${encodeURIComponent(next)}`), next).toBe("/");
    expect(await to("")).toBe("/");
  });

  it("sends a signed-out visitor of the account page to sign-in, and shows it signed in", async () => {
    const out = await send("/account");
    expect(out.status).toBe(307);
    expect(out.headers.get("location")).toBe("/sign-in?next=%2Faccount");
    const t = text(await page("/account", await ownerCookie()));
    for (const label of ["Profile", "Test Owner", "Save name", "Current password", "Change password"])
      expect(t, label).toContain(label);
  });

  it("puts the account menu in the admin header and a Settings tab in the nav", async () => {
    await seed("default");
    const html = await page("/admin", await ownerCookie());
    expect(html).toMatch(/<button[^>]*id="account-menu"[^>]*>.*Test Owner.*owner.*<\/button>/s);
    expect(html).toContain('href="/admin/settings"');
  });

  it("lists users with role and last sign-in, and pending invites", async () => {
    const cookie = await ownerCookie();
    const res = await write(
      "/api/admin/invites",
      { role: "admin", email: testEmail("new-admin") },
      { cookie },
    );
    expect(res.status).toBe(201);
    const html = await page("/admin/settings/users", cookie);
    const t = text(html);
    for (const label of ["People", "Test Owner", "(you)", "last sign-in 20", "Invites", "Create invite"])
      expect(t, label).toContain(label);
    expect(t).toContain("Admin for");
    expect(html).toContain('aria-label="Remove Test Owner"');
    // The invite's link is shown once when created, never in the list.
    expect(html).not.toContain(IssuedInvite.parse(await res.json()).url);
  });

  it("renders an invite's page, then says a used or unknown link cannot be used", async () => {
    const cookie = await ownerCookie();
    const issued = IssuedInvite.parse(
      await (await write("/api/admin/invites", { role: "viewer" }, { cookie })).json(),
    );
    const path = new URL(issued.url).pathname;
    const html = await page(path);
    const t = text(html);
    expect(t).toContain("Join Uptellis");
    expect(t).toContain("You are invited as viewer");
    expect(t).toContain("Create account");
    expect(html).toContain('<meta name="referrer" content="no-referrer"/>');

    const accepted = await write(`/api/invites/${path.split("/").pop()}/accept`, {
      name: "Test Viewer",
      email: testEmail("viewer-ssr"),
      password: "test-viewer-password",
    });
    expect(accepted.status).toBe(201);
    expect(sessionCookie(accepted)).not.toBeNull();
    expect(text(await page(path))).toContain("This invite cannot be used");
    expect(text(await page("/invite/not-a-token"))).toContain("This invite cannot be used");
  });

  it("shows API keys under Sources without their secrets, next to the ingest keys", async () => {
    const cookie = await ownerCookie();
    const res = await write(
      "/api/admin/sites/demo/api-keys",
      { name: "ssr pusher", scopes: ["ingest"] },
      { cookie },
    );
    expect(res.status).toBe(201);
    const { key, prefix } = IssuedApiKey.parse(await res.json());
    const html = await page("/admin/settings/sources", cookie);
    const t = text(html);
    for (const label of ["Sources and keys", "API keys", "ssr pusher", prefix, "Create API key"])
      expect(t, label).toContain(label);
    expect(html).not.toContain(key);
  });

  it("creates a site through the admin API, once per slug", async () => {
    const cookie = await ownerCookie();
    const config = {
      v: 1,
      slug: "acme-two",
      name: "Acme Two",
      hostnames: ["two.example.com"],
      theme: "b-control-room",
      visibility: "private",
      sources: [],
      sections: [],
      branding: { title: "Acme Two" },
    };
    const created = await write("/api/admin/sites", { config }, { cookie });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ version: 1, diff: [] });
    expect((await write("/api/admin/sites", { config }, { cookie })).status).toBe(409);
    expect(
      (await write("/api/admin/sites", { config: { ...config, slug: "demo" } }, { cookie })).status,
    ).toBe(409);
    expect((await write("/api/admin/sites", { config })).status).toBe(401);
    const state = await (await send("/api/admin/sites/acme-two/config", { headers: { cookie } })).json();
    expect(state).toMatchObject({ version: 1, config: { name: "Acme Two", visibility: "private" } });
  });
});
