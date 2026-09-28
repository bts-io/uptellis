/**
 * The delivery log read (`GET /api/admin/sites/:site/notifications`): signed in with `config.edit`, newest
 * first, `limit`, unknown sites, and only short error codes.
 *
 * TODO(p6b-integration): needs migration 0006 (the `channels` stream). Until it lands, `withChannelColumns`
 * adds the columns it will add (`channel`, `attempts`, `retryable`, `last_attempt_at`) when they are
 * missing; once 0006 is merged the guard finds them and does nothing, and the shim can be deleted.
 */
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { ConfigErrorResponse, DeliveryList } from "@/shared/schemas/admin";
import { resetConfigCache } from "@/worker/engine/config-store";
import { admin, adminCookie, handle, json } from "./admin-app";

const DB = (env as unknown as Env).DB;
const PREFIX = "p6b-log:";

async function withChannelColumns() {
  const { results } = await DB.prepare("PRAGMA table_info(notifications)").all<{ name: string }>();
  const have = new Set(results.map((r) => r.name));
  const add = [
    ["channel", "text NOT NULL DEFAULT 'discord'"],
    ["attempts", "integer NOT NULL DEFAULT 0"],
    ["retryable", "integer"],
    ["last_attempt_at", "integer"],
  ].filter(([name]) => !have.has(name!));
  for (const [name, decl] of add) await DB.exec(`ALTER TABLE notifications ADD COLUMN ${name} ${decl}`);
}

/** Far-future times, so these rows are the newest whatever else the file's D1 holds. */
const T = (m: number) => Date.parse("2099-01-01T00:00:00Z") + m * 60_000;

async function seed() {
  await DB.prepare("DELETE FROM notifications WHERE incident_id LIKE ?").bind(`${PREFIX}%`).run();
  const row = DB.prepare(
    `INSERT INTO notifications
      (site, incident_id, kind, status, sent_at, error, created_at, channel, attempts, retryable, last_attempt_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  await DB.batch([
    row.bind("demo", `${PREFIX}a`, "open", "sent", T(1), null, T(1), "ops", 1, null, T(1)),
    row.bind("demo", `${PREFIX}a`, "resolve", "failed", null, "http_503", T(3), "pager", 3, 1, T(4)),
    row.bind(
      "demo",
      `${PREFIX}b`,
      "open",
      "failed",
      null,
      "Body: see https://x.example.org",
      T(2),
      "ops",
      1,
      0,
      T(2),
    ),
    row.bind("other-site", `${PREFIX}c`, "open", "sent", T(9), null, T(9), "ops", 1, null, T(9)),
  ]);
}

let api: ReturnType<typeof admin>;

beforeAll(async () => {
  resetConfigCache();
  await withChannelColumns();
  await seed();
  api = admin(await adminCookie());
});

describe("GET /api/admin/sites/:site/notifications", () => {
  it("answers 401 signed out", async () => {
    expect((await handle("/api/admin/sites/demo/notifications")).status).toBe(401);
  });

  it("lists the site's deliveries newest first, with short error codes only", async () => {
    const res = await api.get("/sites/demo/notifications?limit=3");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { deliveries } = DeliveryList.parse(await json(res));
    expect(deliveries).toEqual([
      {
        incidentId: `${PREFIX}a`,
        kind: "resolve",
        channel: "pager",
        status: "failed",
        attempts: 3,
        retryable: true,
        createdAt: "2099-01-01T00:03:00Z",
        sentAt: null,
        lastAttemptAt: "2099-01-01T00:04:00Z",
        error: "http_503",
      },
      {
        incidentId: `${PREFIX}b`,
        kind: "open",
        channel: "ops",
        status: "failed",
        attempts: 1,
        retryable: false,
        createdAt: "2099-01-01T00:02:00Z",
        sentAt: null,
        lastAttemptAt: "2099-01-01T00:02:00Z",
        error: "error",
      },
      {
        incidentId: `${PREFIX}a`,
        kind: "open",
        channel: "ops",
        status: "sent",
        attempts: 1,
        retryable: null,
        createdAt: "2099-01-01T00:01:00Z",
        sentAt: "2099-01-01T00:01:00Z",
        lastAttemptAt: "2099-01-01T00:01:00Z",
        error: null,
      },
    ]);
  });

  it("honours limit and defaults to 50", async () => {
    const one = DeliveryList.parse(await json(await api.get("/sites/demo/notifications?limit=1")));
    expect(one.deliveries.map((d) => d.channel)).toEqual(["pager"]);
    const all = DeliveryList.parse(await json(await api.get("/sites/demo/notifications")));
    expect(all.deliveries.length).toBeGreaterThanOrEqual(3);
    expect(all.deliveries.length).toBeLessThanOrEqual(50);
    expect(all.deliveries.some((d) => d.incidentId === `${PREFIX}c`)).toBe(false);
  });

  it("refuses a bad limit and an unknown site", async () => {
    for (const q of ["0", "201", "abc", "1.5"]) {
      const res = await api.get(`/sites/demo/notifications?limit=${q}`);
      expect(res.status, q).toBe(400);
      expect(ConfigErrorResponse.parse(await json(res)).issues[0]?.path).toBe("limit");
    }
    const res = await api.get("/sites/nope/notifications");
    expect(res.status).toBe(404);
  });
});
