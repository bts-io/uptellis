import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseSiteConfig, type SiteConfig } from "@/shared/config";
import type { Incident } from "@/shared/model";
import { schema } from "@/worker/db";
import { D1Store } from "@/worker/engine/d1-store";
import type { ConfigSource } from "@/worker/engine/sites";
import { IncidentNotifier, type NotifierDeps } from "@/worker/notify";
import { testPlatform } from "../support/platform";
import { beat, delta, service } from "./storage-helpers";

// An SMS channel through the dispatcher, against a fake Twilio: never a real request. The SID and token are
// assembled at runtime (the repo-wide literal scan), and the numbers are fictional (555-01xx).
const HEX = "0123456789abcdef";
const SID = `AC${HEX}${HEX}`;
const TOKEN = `${HEX}${HEX}`;
const FROM = "+15555550100";
const TO = "+15555550123";
const SECRETS: Record<string, string> = { NOTIFY_TWILIO_TOKEN: TOKEN };

const SMS = {
  id: "sms-ops",
  name: "SMS (Ops)",
  type: "sms",
  provider: "twilio",
  accountSid: SID,
  secret: "NOTIFY_TWILIO_TOKEN",
  from: FROM,
  to: TO,
};

const platform = testPlatform();
const db = platform.db;
let day = "2026-11-01";
const T = (hms: string) => `${day}T${hms}Z`;
const at = (hms: string) => Date.parse(T(hms));

afterEach(() => vi.restoreAllMocks());

function siteConfig(slug: string, channels: unknown[] = [SMS]): SiteConfig {
  return parseSiteConfig({
    v: 1,
    slug,
    name: "Acme Cloud",
    hostnames: ["status.example.com"],
    theme: "a-sys-status",
    sources: [],
    sections: [],
    branding: { title: "Acme Cloud" },
    notify: { discord: false, channels },
  });
}

/** A notifier over the test D1 whose fetch plays Twilio, answering `answers` in turn and then 201. */
function harness(config: SiteConfig, answers: Response[] = []) {
  const posts: { url: string; form: URLSearchParams }[] = [];
  const sleeps: number[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (new URL(url).hostname !== "api.twilio.com") throw new Error("unexpected fetch");
    posts.push({ url, form: new URLSearchParams(String(init?.body)) });
    return answers.shift() ?? Response.json({ sid: "SM1", status: "queued" }, { status: 201 });
  });
  const configs: ConfigSource = {
    current: async (slug) => (slug === config.slug ? { config, version: 1 } : null) as never,
    slugs: async () => [config.slug],
  };
  const deps: NotifierDeps = {
    db,
    configs,
    secret: (name) => SECRETS[name],
    email: null,
    emailFrom: undefined,
    fetch,
    sleep: async (ms) => void sleeps.push(ms),
    now: () => at("10:00:00"),
  };
  return { notifier: new IncidentNotifier(deps), posts, sleeps };
}

/** Opens and later resolves a `down` incident of kuma:1 on `site`. */
async function outage(site: string): Promise<{ opened: Incident[]; resolved: Incident[] }> {
  const store = new D1Store(platform);
  const down = await store.applyDelta(
    delta(site, T("10:00:00"), {
      services: [service(site, "1", "down", "Checkout")],
      heartbeats: [{ ...beat(site, "kuma:1", T("09:59:30"), "down"), message: "HTTP 503" }],
    }),
  );
  const up = await store.applyDelta(
    delta(site, T("10:30:00"), {
      services: [service(site, "1", "up", "Checkout")],
      heartbeats: [beat(site, "kuma:1", T("10:29:30"), "up")],
    }),
  );
  return { opened: down.incidentsOpened, resolved: up.incidentsResolved };
}

const row = async (site: string, kind: "open" | "resolve") =>
  (
    await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.site, site), eq(schema.notifications.kind, kind)))
  )[0];

describe("sms channel through the dispatcher", () => {
  it("texts one down and one up per transition, once, and logs no number", async () => {
    day = "2026-11-01";
    const site = "t-sms-fan";
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
    vi.spyOn(console, "warn").mockImplementation((...a) => void logs.push(a.join(" ")));
    const { notifier, posts } = harness(siteConfig(site));
    const t = await outage(site);

    await notifier.notify(site, { opened: t.opened, resolved: [] });
    await notifier.notify(site, { opened: t.opened, resolved: [] });
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`);
    expect(Object.fromEntries(posts[0]!.form)).toEqual({
      To: TO,
      From: FROM,
      Body: "DOWN: Checkout (Acme Cloud) since 09:59 UTC. status.example.com",
    });

    await notifier.notify(site, { opened: [], resolved: t.resolved });
    await notifier.notify(site, { opened: [], resolved: t.resolved });
    expect(posts).toHaveLength(2);
    expect(posts[1]!.form.get("Body")).toBe(
      "UP: Checkout (Acme Cloud) is back after 30 min. status.example.com",
    );
    expect(await row(site, "open")).toMatchObject({ channel: "sms-ops", status: "sent", attempts: 1 });
    expect(await row(site, "resolve")).toMatchObject({ channel: "sms-ops", status: "sent" });

    expect(logs.some((l) => l.includes('"type":"sms"'))).toBe(true);
    for (const l of logs) for (const x of [TO, FROM, SID, TOKEN]) expect(l).not.toContain(x);
  });

  it("sends no stale by default", async () => {
    day = "2026-11-02";
    const site = "t-sms-stale";
    const store = new D1Store(platform);
    await store.applyDelta(delta(site, T("10:00:00"), {}));
    const opened = await store.sweepStaleness(site, T("10:06:00"));
    expect(opened.incidentsOpened.map((i) => i.kind)).toEqual(["stale"]);
    const { notifier, posts } = harness(siteConfig(site));
    await notifier.notify(site, { opened: opened.incidentsOpened, resolved: [] });
    expect(posts).toEqual([]);
    expect(await row(site, "open")).toBeUndefined();
  });

  it("retries a 429 and a 5xx in the request, then records one delivery", async () => {
    day = "2026-11-03";
    const site = "t-sms-retry";
    const limited = Response.json({ code: 20429, message: "Too Many Requests" }, { status: 429 });
    limited.headers.set("retry-after", "2");
    const { notifier, posts, sleeps } = harness(siteConfig(site), [
      limited,
      Response.json({ code: 20500, message: "Internal" }, { status: 500 }),
    ]);
    const t = await outage(site);
    await notifier.notify(site, { opened: t.opened, resolved: [] });
    expect(posts).toHaveLength(3);
    expect(sleeps).toEqual([2000, 4000]);
    expect(await row(site, "open")).toMatchObject({ status: "sent", attempts: 3, retryable: false });
  });

  it("records a bad number as final with a short code and no number, and sends no up after it", async () => {
    day = "2026-11-04";
    const site = "t-sms-final";
    const echo = { code: 21211, message: `The 'To' number ${TO} is not a valid phone number.`, status: 400 };
    const { notifier, posts } = harness(siteConfig(site), [Response.json(echo, { status: 400 })]);
    const t = await outage(site);
    await notifier.notify(site, { opened: t.opened, resolved: [] });
    const failed = await row(site, "open");
    expect(failed).toMatchObject({
      status: "failed",
      error: "invalid_number",
      retryable: false,
      attempts: 1,
    });
    expect(JSON.stringify(failed)).not.toContain(TO.slice(1));
    await notifier.notify(site, { opened: [], resolved: t.resolved });
    expect(posts).toHaveLength(1);
    expect(await row(site, "resolve")).toBeUndefined();
  });
});
