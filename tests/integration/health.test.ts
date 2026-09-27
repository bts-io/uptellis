import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import pkg from "../../package.json";

describe("api (Hono in workerd)", () => {
  it("reports health", async () => {
    const res = await SELF.fetch("https://example.com/api/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({
      ok: true,
      service: "uptellis",
      version: pkg.version,
      build: "dev",
      commit: "dev",
    });
  });

  it("answers unknown API paths with a JSON 404", async () => {
    const res = await SELF.fetch("https://example.com/api/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "not_found" });
  });
});
