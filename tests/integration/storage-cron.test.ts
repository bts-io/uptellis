import { env } from "cloudflare:test";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CRON_DAILY, CRON_EVERY_5_MIN, runCron } from "@/worker/cron";
import { createDb, schema } from "@/worker/db";
import { D1Store } from "@/worker/engine/d1-store";
import { KvModelCache } from "@/worker/engine/kv-cache";
import { beat, delta, service } from "./storage-helpers";

const db = createDb(env.DB);
const store = new D1Store(env.DB);
const at = (iso: string) => Date.parse(iso);
const buckets = (site: string) =>
  db
    .select()
    .from(schema.heartbeat5m)
    .where(eq(schema.heartbeat5m.site, site))
    .orderBy(asc(schema.heartbeat5m.bucket));

describe("cron: five-minute job", () => {
  it("folds finished windows into heartbeat_5m, idempotently, and refolds late beats", async () => {
    const site = "t-fold";
    const t = (hms: string) => `2026-09-20T${hms}Z`;
    await store.applyDelta(
      delta(site, t("00:11:00"), {
        services: [service(site, "1", "up")],
        heartbeats: [
          beat(site, "kuma:1", t("00:00:10"), "up", 100),
          beat(site, "kuma:1", t("00:01:10"), "down"),
          beat(site, "kuma:1", t("00:02:10"), "maintenance"),
          beat(site, "kuma:1", t("00:04:59"), "pending", 50),
          beat(site, "kuma:1", t("00:05:00"), "up", 300),
          // In the unfinished window at 00:12: not folded yet.
          beat(site, "kuma:1", t("00:10:30"), "up", 90),
        ],
      }),
    );
    const event = { cron: CRON_EVERY_5_MIN, scheduledTime: at(t("00:12:00")) };
    const r = await runCron(env, event);
    expect(r.job).toBe("five-minute");
    expect(r.downsampled).toEqual({ from: at(t("00:10:00")) - 2 * 3600_000, to: at(t("00:10:00")) });

    const expected = [
      {
        site,
        serviceId: "kuma:1",
        bucket: at(t("00:00:00")),
        total: 4,
        up: 1,
        down: 1,
        maint: 1,
        pending: 1,
        pingAvg: 75,
        pingMax: 100,
      },
      {
        site,
        serviceId: "kuma:1",
        bucket: at(t("00:05:00")),
        total: 1,
        up: 1,
        down: 0,
        maint: 0,
        pending: 0,
        pingAvg: 300,
        pingMax: 300,
      },
    ];
    expect(await buckets(site)).toEqual(expected);

    await runCron(env, event);
    expect(await buckets(site)).toEqual(expected);

    // A late beat in an already folded window is picked up on the next run.
    await store.applyDelta(
      delta(site, t("00:13:00"), { heartbeats: [beat(site, "kuma:1", t("00:03:00"), "up", 200)] }),
    );
    await runCron(env, { cron: CRON_EVERY_5_MIN, scheduledTime: at(t("00:15:00")) });
    const after = await buckets(site);
    expect(after[0]).toMatchObject({ total: 5, up: 2, pingAvg: (100 + 50 + 200) / 3, pingMax: 200 });
    expect(after.map((b) => b.bucket)).toEqual([at(t("00:00:00")), at(t("00:05:00")), at(t("00:10:00"))]);
  });

  it("sweeps staleness for every site and refreshes latest:<site>", async () => {
    const site = "t-cronstale";
    await store.applyDelta(delta(site, "2026-09-21T10:00:00Z", { services: [service(site, "1", "up")] }));
    const r = await runCron(env, { cron: CRON_EVERY_5_MIN, scheduledTime: at("2026-09-21T10:10:00Z") });
    expect(r.opened?.filter((i) => i.site === site).map((i) => i.id)).toEqual([
      "kuma:watch-1:2026-09-21T10:05:00Z",
    ]);
    const cached = await new KvModelCache(env.CACHE).get(site);
    expect(cached?.openIncidents.map((i) => i.kind)).toEqual(["stale"]);
  });

  it("ignores an unknown trigger", async () => {
    expect((await runCron(env, { cron: "0 0 * * *", scheduledTime: 0 })).job).toBe("unknown");
  });
});

describe("cron: daily prune", () => {
  it("removes rows past retention and keeps the rest", async () => {
    const site = "t-prune";
    const now = at("2026-09-27T03:17:00Z");
    const h = 3600_000;
    const d = 24 * h;
    await db.batch([
      db.insert(schema.heartbeats).values([
        { site, serviceId: "kuma:1", ts: now - 27 * h, status: "up" },
        { site, serviceId: "kuma:1", ts: now - 25 * h, status: "up" },
      ]),
      db.insert(schema.heartbeat5m).values([
        { site, serviceId: "kuma:1", bucket: now - 91 * d, total: 1, up: 1, down: 0, maint: 0, pending: 0 },
        { site, serviceId: "kuma:1", bucket: now - 89 * d, total: 1, up: 1, down: 0, maint: 0, pending: 0 },
      ]),
      db.insert(schema.factSamples).values([
        { site, grp: "disk", key: "percent", ts: now - 91 * d, value: 1 },
        { site, grp: "disk", key: "percent", ts: now - 89 * d, value: 2 },
      ]),
      db.insert(schema.snapshots).values([
        {
          site,
          sourceId: "kuma:watch-1",
          receivedAt: now - 8 * d,
          generatedAt: now - 8 * d,
          ok: true,
          body: "{}",
        },
        {
          site,
          sourceId: "kuma:watch-1",
          receivedAt: now - 6 * d,
          generatedAt: now - 6 * d,
          ok: true,
          body: "{}",
        },
      ]),
      db.insert(schema.ingestNonces).values([
        { nonce: "t-prune-old", expiresAt: now - 1 },
        { nonce: "t-prune-new", expiresAt: now + h },
      ]),
      db.insert(schema.incidents).values(
        [
          { id: "kuma:1:old-closed", startedAt: now - 400 * d, endedAt: now - 399 * d },
          { id: "kuma:1:recent-closed", startedAt: now - 300 * d, endedAt: now - 299 * d },
          { id: "kuma:1:old-open", startedAt: now - 400 * d, endedAt: null },
        ].map((i) => ({ ...i, site, kind: "down" as const, serviceId: "kuma:1", title: "Service 1 down" })),
      ),
    ]);

    const r = await runCron(env, { cron: CRON_DAILY, scheduledTime: now });
    expect(r.job).toBe("daily");
    expect(r.pruned?.heartbeats).toBeGreaterThanOrEqual(1);

    const hb = await db.select().from(schema.heartbeats).where(eq(schema.heartbeats.site, site));
    expect(hb.map((r) => r.ts)).toEqual([now - 25 * h]);
    const b5 = await db.select().from(schema.heartbeat5m).where(eq(schema.heartbeat5m.site, site));
    expect(b5.map((r) => r.bucket)).toEqual([now - 89 * d]);
    const fs = await db.select().from(schema.factSamples).where(eq(schema.factSamples.site, site));
    expect(fs.map((r) => r.value)).toEqual([2]);
    const sn = await db.select().from(schema.snapshots).where(eq(schema.snapshots.site, site));
    expect(sn.map((r) => r.receivedAt)).toEqual([now - 6 * d]);
    const nonces = await db.select().from(schema.ingestNonces);
    expect(nonces.map((n) => n.nonce)).toContain("t-prune-new");
    expect(nonces.map((n) => n.nonce)).not.toContain("t-prune-old");
    const inc = await db
      .select()
      .from(schema.incidents)
      .where(and(eq(schema.incidents.site, site)))
      .orderBy(asc(schema.incidents.id));
    expect(inc.map((i) => i.id)).toEqual(["kuma:1:old-open", "kuma:1:recent-closed"]);
  });
});
