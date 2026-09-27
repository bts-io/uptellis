import { env, SELF } from "cloudflare:test";
import { beforeAll, expect, it } from "vitest";

// Own file: it breaks the database for everything after it.
const get = (path: string, init?: RequestInit) =>
  SELF.fetch(`https://example.com${path}`, { redirect: "manual", ...init });

let cookie = "";
beforeAll(async () => {
  cookie = ((await get("/?key=test-viewer-key")).headers.get("set-cookie") ?? "").split(";")[0]!;
});

it("shows the error page, which retries, when the API fails; no error details leak", async () => {
  const worker = env as unknown as Env;
  await worker.CACHE.delete("latest:demo");
  await worker.DB.exec("DROP TABLE services");

  const res = await get("/", { headers: { cookie } });
  const html = await res.text();
  expect(res.status).toBe(500);
  expect(html).toContain("Status data is unavailable");
  expect(html).toContain("Retrying in");
  expect(html).toContain("Retry now");
  expect(html).toMatch(/<html[^>]*data-theme="a"/);
  expect(html).not.toMatch(/no such table|SQLITE|D1_ERROR|\bat \S+:\d+:\d+/i);
});
