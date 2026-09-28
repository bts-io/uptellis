/** The Docker adapter over a temp SQLite file: migrations, the kv cache, batches, limiters, secrets, waitUntil. */
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { fixedWindowLimiter } from "@/platform/docker/rate-limit";
import { RATE_LIMITERS } from "@/platform/types";
import { schema } from "@/worker/db";
import { changesOf } from "@/worker/db/util";
import { type TempPlatform, tempPlatform } from "./support";

let t: TempPlatform;
afterEach(() => t?.dispose());

const journal = (await Bun.file(new URL("../../migrations/meta/_journal.json", import.meta.url)).json()) as {
  entries: { tag: string }[];
};

describe("migrations", () => {
  it("applies every migration at startup, in WAL mode, and a reopen keeps the data", async () => {
    t = tempPlatform();
    const { db } = t.platform;
    const tables = await db.all<{ name: string }>(sql`select name from sqlite_master where type = 'table'`);
    for (const name of [
      "sites",
      "site_configs",
      "services",
      "heartbeats",
      "incidents",
      "kv",
      "notifications",
    ]) {
      expect(tables.map((r) => r.name)).toContain(name);
    }
    const applied = await db.all<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`);
    expect(applied[0]?.n).toBe(journal.entries.length);
    const mode = await db.all<{ journal_mode: string }>(sql`pragma journal_mode`);
    expect(mode[0]?.journal_mode).toBe("wal");

    await t.platform.kv.put("kept", { v: 1 });
    const again = t.reopen();
    expect(await again.kv.get<{ v: number }>("kept")).toEqual({ v: 1 });
    const reapplied = await again.db.all<{ n: number }>(sql`select count(*) as n from __drizzle_migrations`);
    expect(reapplied[0]?.n).toBe(journal.entries.length);
  });
});

describe("kv", () => {
  it("stores JSON, overwrites, deletes, and hides entries once they expire", async () => {
    t = tempPlatform();
    const { kv } = t.platform;
    expect(await kv.get<object>("missing")).toBeNull();
    await kv.put("a", { n: 1, s: "x" }, { ttlS: 60 });
    await kv.put("b", [1, 2]);
    expect(await kv.get<object>("a", { cacheTtlS: 30 })).toEqual({ n: 1, s: "x" });
    await kv.put("a", { n: 2 }, { ttlS: 60 });
    expect(await kv.get<object>("a")).toEqual({ n: 2 });

    t.clock.now += 59_999;
    expect(await kv.get<object>("a")).toEqual({ n: 2 });
    t.clock.now += 1;
    expect(await kv.get<object>("a")).toBeNull();
    expect(await kv.get<number[]>("b")).toEqual([1, 2]);

    await kv.delete("b");
    expect(await kv.get<number[]>("b")).toBeNull();
  });
});

describe("batch", () => {
  it("returns each statement's result as Drizzle would: rows for returning, run results with changes", async () => {
    t = tempPlatform();
    const { db, batch } = t.platform;
    const results = await batch([
      db.insert(schema.kv).values({ key: "x", value: "1" }).returning({ key: schema.kv.key }),
      db.insert(schema.kv).values({ key: "y", value: "1" }),
      db.select().from(schema.kv),
      db.delete(schema.kv).where(sql`1 = 1`),
    ]);
    expect(results[0]).toEqual([{ key: "x" }]);
    expect(changesOf(results[1])).toBe(1);
    expect((results[2] as unknown[]).length).toBe(2);
    expect(changesOf(results[3])).toBe(2);
  });

  it("is atomic: a failing statement rolls back the ones before it", async () => {
    t = tempPlatform();
    const { db, batch } = t.platform;
    await db.insert(schema.kv).values({ key: "taken", value: "1" });
    await expect(
      batch([
        db.insert(schema.kv).values({ key: "new", value: "1" }),
        db.insert(schema.kv).values({ key: "taken", value: "2" }),
      ]),
    ).rejects.toThrow();
    const rows = await db.select().from(schema.kv);
    expect(rows).toEqual([{ key: "taken", value: "1", expiresAt: null }]);
  });
});

describe("rate limiters", () => {
  it("allow `limit` requests per key in each fixed window", async () => {
    let now = 120_000;
    const limiter = fixedWindowLimiter(2, 60, () => now);
    expect([await limiter.limit("a"), await limiter.limit("a"), await limiter.limit("a")]).toEqual([
      true,
      true,
      false,
    ]);
    expect(await limiter.limit("b")).toBe(true);
    now += 59_999;
    expect(await limiter.limit("a")).toBe(false);
    now += 1;
    expect(await limiter.limit("a")).toBe(true);
  });

  it("exist for every RATE_LIMITERS name with its budget", async () => {
    t = tempPlatform();
    for (const [name, { limit }] of Object.entries(RATE_LIMITERS)) {
      const limiter = t.platform.rateLimiter(name as keyof typeof RATE_LIMITERS)!;
      const answers: boolean[] = [];
      for (let i = 0; i <= limit; i++) answers.push(await limiter.limit("k"));
      expect(answers.filter(Boolean).length, name).toBe(limit);
      expect(answers.at(-1), name).toBe(false);
    }
  });
});

describe("secrets and settings", () => {
  it("come from env vars or <NAME>_FILE, trimmed, the variable winning, empty as unset", () => {
    t = tempPlatform();
    const file = join(t.dir, "hook");
    writeFileSync(file, "https://discord.test/api/webhooks/1/x\n");
    const p = tempPlatform({
      DISCORD_WEBHOOK_URL_FILE: file,
      SOURCE_MASTER_KEY: "  direct  ",
      SOURCE_MASTER_KEY_FILE: "/nonexistent",
      SITE_DEFAULT: "demo",
      PUBLIC_URL: "",
    });
    try {
      expect(p.platform.runtime).toBe("docker");
      expect(p.platform.secret("DISCORD_WEBHOOK_URL")).toBe("https://discord.test/api/webhooks/1/x");
      expect(p.platform.secret("SOURCE_MASTER_KEY")).toBe("direct");
      expect(p.platform.secret("BETTER_AUTH_SECRET")).toBeUndefined();
      expect(p.platform.setting("SITE_DEFAULT")).toBe("demo");
      expect(p.platform.setting("PUBLIC_URL")).toBeUndefined();
    } finally {
      p.dispose();
    }
  });
});

describe("waitUntil", () => {
  it("tracks background work until drained, and logs a failure by name only", async () => {
    t = tempPlatform();
    const errors = spyOn(console, "error").mockImplementation(() => {});
    let done = false;
    t.platform.waitUntil(
      new Promise<void>((r) => setTimeout(r, 20)).then(() => {
        done = true;
      }),
    );
    t.platform.waitUntil(Promise.reject(new TypeError("secret detail")));
    await t.platform.drain();
    expect(done).toBe(true);
    expect(errors.mock.calls.map((c) => c.join(" "))).toEqual([
      JSON.stringify({ evt: "background", name: "TypeError" }),
    ]);
    errors.mockRestore();
  });
});
