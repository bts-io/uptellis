import { createExecutionContext, env, SELF, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { findForbiddenLiterals } from "@/shared/model";
import { ConfigState } from "@/shared/schemas/admin";
import { REGISTERED } from "../support/registered-themes";
import { seed } from "./seed";

// `/admin` server-rendered by the built Worker. vitest.config.ts gives the SSR project no ADMIN_KEY (so
// through SELF admin is always 404), so these requests call the built entry directly with one added.
const ORIGIN = "https://status.example.com";
const builtPath = "../../dist/server/index.js";
type Entry = { fetch: (r: Request, e: Env, c: ExecutionContext) => Promise<Response> };
const built = ((await import(/* @vite-ignore */ builtPath)) as { default: Entry }).default;
// The sealing key is random per run, like tests/integration/admin-app.ts.
const masterKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const adminEnv = {
  ...(env as unknown as Env),
  ADMIN_KEY: "test-admin-key",
  SOURCE_MASTER_KEY: masterKey,
} as Env;

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await built.fetch(
    new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init }),
    adminEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

let cookie = "";
const page = async (path: string) => {
  const res = await send(path, { headers: { cookie } });
  expect(res.status, path).toBe(200);
  return res.text();
};
/** Text content of the HTML (tags dropped, React's text separators too), for readable assertions. */
const text = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

beforeAll(async () => {
  await seed("default");
  const login = await send("/admin?admin=test-admin-key");
  expect(login.status).toBe(302);
  cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
  expect(cookie).toMatch(/^uptellis_admin=/);
});

describe("/admin gate", () => {
  it("is the 404 page without the admin cookie, also with a viewer cookie", async () => {
    expect((await send("/admin")).status).toBe(404);
    const viewer = (
      (await SELF.fetch(`${ORIGIN}/?key=test-viewer-key`, { redirect: "manual" })).headers.get(
        "set-cookie",
      ) ?? ""
    ).split(";")[0]!;
    for (const path of ["/admin", "/admin/revisions", "/admin/sources"]) {
      const res = await send(path, { headers: { cookie: viewer } });
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).not.toContain("admin");
    }
    expect((await SELF.fetch(`${ORIGIN}/admin`, { headers: { cookie } })).status).toBe(404);
  });
});

describe("/admin pages", () => {
  it("renders the config form with the saved config, the registered themes and the live services", async () => {
    const html = await page("/admin");
    const t = text(html);
    expect(html).toMatch(/<title>Admin \| DEMO status<\/title>/);
    expect(t).toContain("version 1, saved");
    expect(t).toContain("by seed");
    for (const label of [
      "Name",
      "Theme",
      "Branding title",
      "Tagline",
      "Sections",
      "Display names",
      "Thresholds",
      "Links",
    ])
      expect(t, label).toContain(label);
    for (const id of Object.keys(REGISTERED)) expect(html, id).toContain(`<option value="${id}"`);
    expect(html).toMatch(/<option value="a-sys-status" selected=""/);
    const state = ConfigState.parse(
      await (await send("/api/admin/sites/demo/config", { headers: { cookie } })).json(),
    );
    expect(html).toContain(`value="${state.config.name}"`);
    for (const s of state.config.sections) expect(html, s.id).toContain(`value="${s.title}"`);
    expect(t).toContain("Review changes");
    // The rendered page (asset file names in <head> and script tags look like tokens to the scan).
    const body = html.replace(/<head>.*<\/head>/s, "").replace(/<script\b.*?<\/script>/gs, "");
    expect(findForbiddenLiterals(body)).toEqual([]);
  });

  it("lists the revisions and shows a save made through the API", async () => {
    const state = ConfigState.parse(
      await (await send("/api/admin/sites/demo/config", { headers: { cookie } })).json(),
    );
    const put = await send("/api/admin/sites/demo/config", {
      method: "PUT",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({
        config: { ...state.config, name: "Acme Edited" },
        baseVersion: state.version,
        note: "ssr note",
      }),
    });
    expect(put.status).toBe(200);

    const t = text(await page("/admin/revisions"));
    expect(t).toContain("current: version 2");
    expect(t).toContain("ssr note");
    expect(t).toContain("Restore");
    expect(text(await page("/admin"))).toContain("Acme Edited admin");
  });

  it("offers the export download and the import upload", async () => {
    const html = await page("/admin/files");
    expect(html).toContain('href="/api/admin/sites/demo/config/export"');
    expect(html).toContain('download="demo.json"');
    expect(html).toMatch(/<input[^>]*type="file"/);
    expect(text(html)).toContain("Nothing is saved until you confirm the changes.");
  });

  it("previews every registered theme in a scaled frame of /?theme=", async () => {
    const html = await page("/admin/themes");
    const frames = [...html.matchAll(/<iframe[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    expect(frames).toEqual(Object.keys(REGISTERED).map((id) => `/?theme=${id}`));
  });

  it("lists the ingest keys without secrets, and a created key shows up there, still without its secret", async () => {
    const before = text(await page("/admin/sources"));
    for (const keyId of ["collector-1", "facts-1"]) expect(before, keyId).toContain(keyId);
    expect(before).toContain("Create source");

    const res = await send("/api/admin/sites/demo/sources", {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ keyId: "ssr-probe", source: "probe:ssr", kind: "probe", expectedIntervalS: 60 }),
    });
    expect(res.status).toBe(201);
    const { secret } = (await res.json()) as { secret: string };
    const html = await page("/admin/sources");
    expect(text(html)).toContain("ssr-probe");
    expect(text(html)).toContain("probe:ssr");
    expect(html).not.toContain(secret);
  });
});
