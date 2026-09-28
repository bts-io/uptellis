/**
 * Config admin over D1: seed on first read, save with optimistic concurrency, validation issues, revisions
 * and restore, export and import (byte-identical round trip, dry run), and the read path picking up a save.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportSiteConfig, type SiteConfig } from "@/shared/config";
import { ConfigErrorResponse, ConfigState, ImportResult, RevisionList } from "@/shared/schemas/admin";
import { schema } from "@/worker/db";
import { configKey, resetConfigCache } from "@/worker/engine/config-store";
import demo from "../../sites/demo.json";
import { testPlatform } from "../support/platform";
import { admin, adminCookie, adminEnv, handle, json, ORIGIN } from "./admin-app";

const FILE = exportSiteConfig(demo as never);
let api: ReturnType<typeof admin>;
let cookie: string;

const getState = async (): Promise<ConfigState> => {
  const res = await api.get("/sites/demo/config");
  expect(res.status).toBe(200);
  return ConfigState.parse(await json(res));
};

beforeAll(async () => {
  resetConfigCache();
  cookie = await adminCookie();
  api = admin(cookie);
});
afterAll(() => resetConfigCache());

describe("admin config API", () => {
  it("answers 401 signed out and 403 cross-site", async () => {
    expect((await handle("/api/admin/sites/demo/config")).status).toBe(401);
    const put = await handle("/api/admin/sites/demo/config", {
      method: "PUT",
      headers: { cookie, origin: "https://evil.example" },
      body: "{}",
    });
    expect(put.status).toBe(403);
  });

  it("seeds version 1 from sites/demo.json on first read", async () => {
    const state = await getState();
    expect(state).toMatchObject({ version: 1, savedBy: "seed" });
    expect(exportSiteConfig(state.config)).toBe(FILE);
    const rows = await testPlatform().db.select().from(schema.siteConfigs);
    expect(rows.map((r) => [r.site, r.version, r.savedBy])).toEqual([["demo", 1, "seed"]]);
  });

  it("exports the committed file byte for byte, as an attachment", async () => {
    const res = await api.get("/sites/demo/config/export");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="demo.json"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(FILE);
  });

  it("saves a change as version 2 with a field diff, and the dashboard reads it", async () => {
    const config = { ...(await getState()).config, name: "Acme Renamed" };
    const res = await api.put("/sites/demo/config", { config, baseVersion: 1, note: "rename" });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      version: 2,
      diff: [{ path: "name", op: "change", before: demo.name, after: "Acme Renamed" }],
    });
    expect(await getState()).toMatchObject({
      version: 2,
      savedBy: "admin",
      config: { name: "Acme Renamed" },
    });
    const kv = await adminEnv.CACHE.get<ConfigState>(configKey("demo"), "json");
    expect(kv?.version).toBe(2);

    const view = await handle("/api/sites/demo/view", { headers: { cookie } });
    expect(view.status).toBe(200);
    expect((await json(view)).site.name).toBe("Acme Renamed");
  });

  it("answers 409 with the current version for a stale baseVersion", async () => {
    const config = { ...(await getState()).config, name: "Late edit" };
    const res = await api.put("/sites/demo/config", { config, baseVersion: 1 });
    expect(res.status).toBe(409);
    expect(ConfigErrorResponse.parse(await json(res))).toMatchObject({
      error: "conflict",
      currentVersion: 2,
    });
  });

  it("answers 400 with flattened issues for an invalid config, a wrong slug or a bad body", async () => {
    const good = (await getState()).config;
    const bad = {
      ...good,
      theme: "z-nope",
      sections: [{ ...good.sections[0]!, title: "" }, ...good.sections.slice(1)],
    };
    const res = await api.put("/sites/demo/config", { config: bad, baseVersion: 2 });
    expect(res.status).toBe(400);
    const body = ConfigErrorResponse.parse(await json(res));
    expect(body.error).toBe("invalid");
    expect(body.issues.map((i) => i.path)).toContain("theme");

    const slug = await api.put("/sites/demo/config", { config: { ...good, slug: "other" }, baseVersion: 2 });
    expect(slug.status).toBe(400);
    expect((await json(slug)).issues).toEqual([{ path: "slug", message: "Must be demo" }]);

    expect((await api.put("/sites/demo/config", "not json")).status).toBe(400);
    const missing = await api.put("/sites/demo/config", { config: good });
    expect(missing.status).toBe(400);
    expect((await json(missing)).issues.map((i: { path: string }) => i.path)).toContain("baseVersion");
    expect((await getState()).version).toBe(2);
  });

  it("saves nothing when the config is unchanged", async () => {
    const res = await api.put("/sites/demo/config", { config: (await getState()).config, baseVersion: 2 });
    expect(await json(res)).toEqual({ version: 2, diff: [] });
  });

  it("lists revisions newest first with change counts and notes", async () => {
    const list = RevisionList.parse(await json(await api.get("/sites/demo/config/revisions")));
    expect(list.current).toBe(2);
    expect(list.revisions.map((r) => [r.version, r.savedBy, r.note, r.changes])).toEqual([
      [2, "admin", "rename", 1],
      [1, "seed", null, 0],
    ]);
  });

  it("restores an old revision as a new one", async () => {
    const res = await api.post("/sites/demo/config/revisions/1/restore");
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      version: 3,
      diff: [{ path: "name", op: "change", before: "Acme Renamed", after: demo.name }],
    });
    const list = RevisionList.parse(await json(await api.get("/sites/demo/config/revisions")));
    expect(list.revisions[0]).toMatchObject({ version: 3, note: "Restored version 1", changes: 1 });
    expect((await api.post("/sites/demo/config/revisions/99/restore")).status).toBe(404);
    expect((await api.post("/sites/demo/config/revisions/x/restore")).status).toBe(404);
  });

  it("round-trips export and import byte-identically without a new revision", async () => {
    const exported = await (await api.get("/sites/demo/config/export")).text();
    expect(exported).toBe(FILE);
    const imported = ImportResult.parse(await json(await api.post("/sites/demo/config/import", exported)));
    expect(imported).toEqual({ valid: true, issues: [], diff: [], version: null });
    expect(await (await api.get("/sites/demo/config/export")).text()).toBe(exported);
    expect((await getState()).version).toBe(3);
  });

  it("dry-runs an import (diff, nothing saved), then imports it", async () => {
    const edited: SiteConfig = JSON.parse(FILE);
    edited.sections = edited.sections.slice(0, -1);
    edited.branding.tagline = "Imported";
    const text = exportSiteConfig(edited);
    const dry = ImportResult.parse(await json(await api.post("/sites/demo/config/import?dryRun=1", text)));
    expect(dry.valid).toBe(true);
    expect(dry.version).toBeNull();
    expect(dry.diff.map((d) => [d.path, d.op])).toEqual([
      [`sections.${edited.sections.length}`, "remove"],
      ["branding.tagline", "add"],
    ]);
    expect((await getState()).version).toBe(3);

    const real = ImportResult.parse(await json(await api.post("/sites/demo/config/import", text)));
    expect(real).toMatchObject({ valid: true, version: 4 });
    expect(await (await api.get("/sites/demo/config/export")).text()).toBe(text);
    const list = RevisionList.parse(await json(await api.get("/sites/demo/config/revisions")));
    expect(list.revisions[0]).toMatchObject({ version: 4, savedBy: "import" });
  });

  it("reports an invalid import without saving", async () => {
    const notJson = ImportResult.parse(await json(await api.post("/sites/demo/config/import", "{ nope")));
    expect(notJson).toEqual({
      valid: false,
      issues: [{ path: "", message: "Not a JSON file" }],
      diff: [],
      version: null,
    });
    const bad = ImportResult.parse(
      await json(await api.post("/sites/demo/config/import", { ...JSON.parse(FILE), theme: "nope" })),
    );
    expect(bad.valid).toBe(false);
    expect(bad.issues.map((i) => i.path)).toEqual(["theme"]);
    expect((await getState()).version).toBe(4);
  });

  it("answers 404 for an unknown site on every route", async () => {
    for (const [method, path] of [
      ["GET", "/sites/nope/config"],
      ["GET", "/sites/nope/config/export"],
      ["GET", "/sites/nope/config/revisions"],
      ["POST", "/sites/nope/config/import?dryRun=1"],
      ["POST", "/sites/nope/config/revisions/1/restore"],
      ["PUT", "/sites/nope/config"],
      ["GET", "/sites/..%2Fbts/config"],
    ] as const) {
      const res =
        method === "GET"
          ? await api.get(path)
          : method === "PUT"
            ? await api.put(path, { config: JSON.parse(FILE), baseVersion: 1 })
            : await api.post(path, FILE);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect((await handle("/api/sites/nope/view", { headers: { cookie } })).status).toBe(404);
  });

  it("finds the site for a configured hostname", async () => {
    const lookup = async (host: string) =>
      json(await handle(`/api/sites?host=${encodeURIComponent(host)}`, { headers: { cookie } }));
    expect(await lookup(demo.hostnames[0]!)).toEqual({ site: "demo" });
    expect(await lookup(demo.hostnames[0]!.toUpperCase())).toEqual({ site: "demo" });
    expect(await lookup(new URL(ORIGIN).hostname)).toEqual({ site: null });
  });
});
