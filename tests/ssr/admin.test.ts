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
  it("renders the config form with the saved config, the registered themes and the live services", async () => {
    const html = await page("/admin");
    const t = text(html);
    expect(html).toMatch(/<title>Admin \| DEMO status<\/title>/);
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
