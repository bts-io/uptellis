import { beforeAll, describe, expect, it } from "vitest";
import { findForbiddenLiterals } from "@/shared/model";
import { ConfigState } from "@/shared/schemas/admin";
import { REGISTERED } from "../support/registered-themes";
import { ORIGIN, ownerCookie, send } from "./built";
import { seed } from "./seed";

// `/admin` server-rendered by the built Worker, signed in as the owner (tests/ssr/gate.test.ts covers who
// may not see it).
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
  cookie = await ownerCookie();
});

describe("/admin pages", () => {
  it("renders the Monitors dashboard in the shell, with the four tabs", async () => {
    const html = await page("/admin");
    const t = text(html);
    expect(html).toMatch(/<title>Admin \| DEMO status<\/title>/);
    for (const href of ["/admin", "/admin/status-page", "/admin/alerts", "/admin/settings"])
      expect(html, href).toContain(`href="${href}"`);
    for (const label of [
      "Monitors",
      "New monitor",
      "New heartbeat",
      "Uptime, last 30 days",
      "Search by name or address",
    ])
      expect(t, label).toContain(label);
    // Names, never ids, on the rendered page (the hydration script carries the config itself).
    const body = html.replace(/<head>.*<\/head>/s, "").replace(/<script\b.*?<\/script>/gs, "");
    expect(text(body)).not.toMatch(/\b(?:kuma|facts|probe):/);
    expect(findForbiddenLiterals(body)).toEqual([]);
  });

  it("sends the old admin URLs to their new place", async () => {
    for (const [from, to] of [
      ["/admin/sources", "/admin/settings/sources"],
      ["/admin/users", "/admin/settings/users"],
      ["/admin/revisions", "/admin/settings/revisions"],
      ["/admin/files", "/admin/settings/import-export"],
      ["/admin/themes", "/admin/status-page"],
    ]) {
      const res = await send(from!, { headers: { cookie } });
      expect(res.status, from).toBeGreaterThanOrEqual(300);
      expect(res.status, from).toBeLessThan(400);
      expect(new URL(res.headers.get("location")!, ORIGIN).pathname, from).toBe(to);
    }
  });

  it("renders the config form with the saved config, the registered themes and the live services", async () => {
    const html = await page("/admin/settings/advanced");
    const t = text(html);
    expect(t).toContain("version 1, saved");
    expect(t).toContain("by seed");
    for (const label of [
      "Name",
      "Theme",
      "Visibility",
      "Profiles",
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

    const t = text(await page("/admin/settings/revisions"));
    expect(t).toContain("current: version 2");
    expect(t).toContain("ssr note");
    expect(t).toContain("Restore");
    expect(text(await page("/admin"))).toContain("Acme Edited");
  });

  it("offers the export download and the import upload", async () => {
    const html = await page("/admin/settings/import-export");
    expect(html).toContain('href="/api/admin/sites/demo/config/export"');
    expect(html).toContain('download="demo.json"');
    expect(html).toMatch(/<input[^>]*type="file"/);
    expect(text(html)).toContain("Nothing is saved until you confirm the changes.");
  });

  it("previews every registered theme in a scaled frame of /?theme= on the Status page tab", async () => {
    const html = await page("/admin/status-page");
    const frames = [...html.matchAll(/<iframe[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    expect(frames).toEqual(Object.keys(REGISTERED).map((id) => `/?theme=${id}`));
  });

  it("lists the ingest keys without secrets, and a created key shows up there, still without its secret", async () => {
    const before = text(await page("/admin/settings/sources"));
    for (const keyId of ["collector-1", "facts-1"]) expect(before, keyId).toContain(keyId);
    expect(before).toContain("Create source");

    const res = await send("/api/admin/sites/demo/sources", {
      method: "POST",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ keyId: "ssr-probe", source: "probe:ssr", kind: "probe", expectedIntervalS: 60 }),
    });
    expect(res.status).toBe(201);
    const { secret } = (await res.json()) as { secret: string };
    const html = await page("/admin/settings/sources");
    expect(text(html)).toContain("ssr-probe");
    expect(text(html)).toContain("probe:ssr");
    expect(html).not.toContain(secret);
  });
});
