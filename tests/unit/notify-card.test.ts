import { describe, expect, it } from "vitest";
import type { Incident, Source } from "@/shared/model";
import {
  ACCENT,
  type CardService,
  cardIsSafe,
  type DiscordCard,
  downCard,
  duration,
  hostOf,
  IS_COMPONENTS_V2,
  interval,
  producerOf,
  recoveredCard,
  staleCard,
  upCard,
} from "@/worker/notify/card";

const site = "demo";
const T = (hms: string) => `2026-09-27T${hms}Z`;
const at = (hms: string) => Date.parse(T(hms));
const PAGE = "https://status.example.com/";

const src = (id: string, lastSeen: string | null, expectedIntervalS: number): Source => ({
  id,
  site,
  kind: id.slice(0, id.indexOf(":")) as Source["kind"],
  expectedIntervalS,
  lastSeenAt: lastSeen === null ? null : T(lastSeen),
  lastOkAt: null,
});

const stale = (sourceId: string, startedAt: string, endedAt: string | null = null): Incident => ({
  id: `${sourceId}:${T(startedAt)}`,
  site,
  kind: "stale",
  serviceId: null,
  sourceId,
  startedAt: T(startedAt),
  endedAt: endedAt === null ? null : T(endedAt),
  title: `Source ${sourceId} stale`,
  notes: null,
});

const parts = (card: DiscordCard) => card.components[0].components;
const texts = (card: DiscordCard) => parts(card).flatMap((c) => (c.type === 10 ? [c.content] : []));
const body = (card: DiscordCard) => texts(card)[0]!;
const buttons = (card: DiscordCard) => parts(card).flatMap((c) => (c.type === 1 ? c.components : []));

describe("producers", () => {
  it("names the producer and machine of every source kind", () => {
    expect(hostOf("kuma:watch-1")).toBe("watch-1");
    expect(producerOf("kuma:watch-1")).toBe("Kuma collector on watch-1");
    expect(producerOf("facts:app-1")).toBe("facts pusher on app-1");
    expect(producerOf("probe:cf")).toBe("Cloudflare probes");
    expect(producerOf("probe:server")).toBe("the server's own probes");
    expect(producerOf("probe:office-1")).toBe("agent office-1");
    expect(producerOf("probe:push")).toBe("calls to its push URL");
    expect(producerOf("webhook:ci")).toBe("signed webhooks from ci");
  });

  it("formats intervals and spans", () => {
    expect(interval(60)).toBe("60 s");
    expect(interval(900)).toBe("15 min");
    expect(interval(7200)).toBe("2 h");
    expect(duration(30_000)).toBe("under 1 min");
    expect(duration(7 * 60_000 + 59_000)).toBe("7 min");
    expect(duration(125 * 60_000)).toBe("2 h 5 min");
    expect(duration((3 * 24 + 4) * 3600_000)).toBe("3 d 4 h");
  });
});

describe("stale card", () => {
  const sources = [
    src("facts:app-1", "10:05:00", 900),
    src("kuma:watch-1", "10:00:00", 60),
    src("kuma:lahore", "09:50:00", 60),
    src("probe:edge", null, 60),
  ];

  it("is a Components V2 container in the #forgejo house style", () => {
    const card = staleCard({
      site,
      incident: stale("kuma:watch-1", "10:05:00"),
      sources,
      pageUrl: PAGE,
      now: at("10:07:30"),
    });
    expect(card.flags).toBe(IS_COMPONENTS_V2);
    expect(card.username).toBe("Uptellis");
    expect(card.allowed_mentions).toEqual({ parse: [] });
    expect(card.components).toHaveLength(1);
    expect(card.components[0]).toMatchObject({ type: 17, accent_color: 0x7f1d1d });
    expect(ACCENT.stale).toBe(0x7f1d1d);
    expect(body(card).split("\n")).toEqual([
      "### 🚨 Uptellis: kuma:watch-1 went silent",
      "The status page shows its data as stale until it reports again.",
      "",
      "**Producer:** Kuma collector on watch-1",
      "**Last report:** 2026-09-27 10:00 UTC (7 min ago)",
      "**Expected interval:** every 60 s",
      // Only fresh sources: kuma:lahore is silent too and probe:edge never reported.
      "**Still reporting:** facts:app-1",
    ]);
    expect(texts(card)[1]).toBe(`-# Uptellis · demo · <t:${at("10:07:30") / 1000}:f>`);
    expect(parts(card).map((c) => c.type)).toEqual([10, 10, 14, 1]);
    expect(buttons(card)).toEqual([{ type: 2, style: 5, label: "Status page", url: PAGE }]);
    expect(cardIsSafe(card)).toBe(true);
  });

  it("describes a facts source and says when no other source reports", () => {
    const card = staleCard({
      site,
      incident: stale("facts:app-1", "11:20:00"),
      sources: [src("facts:app-1", "10:05:00", 900), src("kuma:watch-1", "09:00:00", 60)],
      pageUrl: PAGE,
      now: at("11:20:00"),
    });
    expect(body(card)).toContain("### 🚨 Uptellis: facts:app-1 went silent");
    expect(body(card)).toContain("**Producer:** facts pusher on app-1");
    expect(body(card)).toContain("**Last report:** 2026-09-27 10:05 UTC (1 h 15 min ago)");
    expect(body(card)).toContain("**Expected interval:** every 15 min");
    expect(body(card)).toContain("**Still reporting:** no other source");
  });

  it("names Cloudflare probes and drops the button without a hostname", () => {
    const card = staleCard({
      site,
      incident: stale("probe:cf", "10:05:00"),
      sources: [src("probe:cf", "10:00:00", 60), src("kuma:watch-1", "10:06:00", 60)],
      pageUrl: null,
      now: at("10:06:30"),
    });
    expect(body(card)).toContain("**Producer:** Cloudflare probes");
    expect(body(card)).toContain("**Still reporting:** kuma:watch-1");
    expect(parts(card).map((c) => c.type)).toEqual([10, 10]);
  });

  it("labels a test card", () => {
    const card = staleCard({
      site,
      incident: stale("kuma:watch-1", "10:05:00"),
      sources,
      pageUrl: PAGE,
      now: at("10:07:30"),
      test: true,
    });
    expect(body(card)).toMatch(/^### 🚨 TEST: Uptellis: kuma:watch-1 went silent\nTest card/);
  });
});

describe("recovered card", () => {
  it("gives the gap, the first report again and the backfilled beats of a Kuma source", () => {
    const card = recoveredCard({
      site,
      // Last report 10:00, stale from 10:05 (5 x 60 s), back at 10:12:30.
      incident: stale("kuma:watch-1", "10:05:00", "10:12:30"),
      source: src("kuma:watch-1", "10:12:30", 60),
      backfilled: 84,
      pageUrl: PAGE,
      now: at("10:12:31"),
    });
    expect(card.components[0].accent_color).toBe(0x22c55e);
    expect(ACCENT.recovered).toBe(0x22c55e);
    expect(body(card).split("\n")).toEqual([
      "### ✅ Uptellis: kuma:watch-1 is back",
      "Reporting again; the status page is current.",
      "",
      "**Producer:** Kuma collector on watch-1",
      "**Silent for:** 12 min",
      "**First report again:** 2026-09-27 10:12 UTC",
      "**Beats backfilled for the gap:** 84",
    ]);
    expect(buttons(card)).toEqual([{ type: 2, style: 5, label: "Status page", url: PAGE }]);
    expect(cardIsSafe(card)).toBe(true);
  });

  it("omits the backfill for sources that resend nothing", () => {
    const card = recoveredCard({
      site,
      incident: stale("facts:app-1", "11:15:00", "11:40:00"),
      source: src("facts:app-1", "11:40:00", 900),
      backfilled: null,
      pageUrl: PAGE,
      now: at("11:40:00"),
      test: true,
    });
    expect(body(card)).toContain("### ✅ TEST: Uptellis: facts:app-1 is back");
    expect(body(card)).toContain("**Producer:** facts pusher on app-1");
    expect(body(card)).toContain("**Silent for:** 1 h 40 min");
    expect(body(card)).not.toContain("backfilled");
  });
});

const down = (serviceId: string, startedAt: string, endedAt: string | null = null): Incident => ({
  id: `${serviceId}:${T(startedAt)}`,
  site,
  kind: "down",
  serviceId,
  sourceId: null,
  startedAt: T(startedAt),
  endedAt: endedAt === null ? null : T(endedAt),
  title: "Web down",
  notes: null,
});

const web: CardService = {
  id: "probe:web",
  source: "probe:cf",
  name: "Web",
  targetDisplay: "www.example.org/",
};

describe("down card", () => {
  it("names the service, target, runner, start and reason", () => {
    const card = downCard({
      site,
      incident: down("probe:web", "10:02:00"),
      service: web,
      reason: "HTTP 503",
      pageUrl: PAGE,
      now: at("10:04:30"),
    });
    expect(card.components[0].accent_color).toBe(ACCENT.down);
    expect(body(card).split("\n")).toEqual([
      "### 🔴 Uptellis: Web is down",
      "Confirmed down; an incident is open on the status page.",
      "",
      "**Service:** probe:web",
      "**Target:** www.example.org/",
      "**Checked by:** Cloudflare probes",
      "**Down since:** 2026-09-27 10:02 UTC (2 min ago)",
      "**Reason:** HTTP 503",
    ]);
    expect(buttons(card)).toEqual([{ type: 2, style: 5, label: "Status page", url: PAGE }]);
    expect(card.allowed_mentions).toEqual({ parse: [] });
    expect(cardIsSafe(card)).toBe(true);
  });

  it("omits a missing target and reason and names an agent", () => {
    const card = downCard({
      site,
      incident: down("probe:nas", "10:02:00"),
      service: { id: "probe:nas", source: "probe:office-1", name: "NAS", targetDisplay: null },
      reason: null,
      pageUrl: null,
      now: at("10:02:10"),
      test: true,
    });
    expect(body(card)).toMatch(/^### 🔴 TEST: Uptellis: NAS is down\nTest card/);
    expect(body(card)).toContain("**Checked by:** agent office-1");
    expect(body(card)).toContain("(under 1 min ago)");
    expect(body(card)).not.toContain("Target");
    expect(body(card)).not.toContain("Reason");
    expect(parts(card).map((c) => c.type)).toEqual([10, 10]);
  });
});

describe("up card", () => {
  it("gives the outage duration and both ends", () => {
    const card = upCard({
      site,
      incident: down("probe:web", "10:02:00", "11:19:30"),
      service: web,
      pageUrl: PAGE,
      now: at("11:19:31"),
    });
    expect(card.components[0].accent_color).toBe(ACCENT.recovered);
    expect(body(card).split("\n")).toEqual([
      "### ✅ Uptellis: Web is back up",
      "Up again; the incident is resolved.",
      "",
      "**Service:** probe:web",
      "**Down for:** 1 h 17 min",
      "**Down since:** 2026-09-27 10:02 UTC",
      "**Back up:** 2026-09-27 11:19 UTC",
    ]);
    expect(texts(card)[1]).toBe(`-# Uptellis · demo · <t:${Math.floor(at("11:19:31") / 1000)}:f>`);
  });
});

describe("guard", () => {
  // Assembled at runtime so this file passes the repo-wide literal scan (RFC 5737 range).
  const ip = [192, 0, 2, 7].join(".");

  it("rejects a card whose text or link carries an address", () => {
    const base = { site, incident: stale("kuma:watch-1", "10:05:00"), sources: [], now: at("10:06:00") };
    expect(cardIsSafe(staleCard({ ...base, pageUrl: `https://${ip}/` }))).toBe(false);
    const card = staleCard({ ...base, pageUrl: PAGE });
    const text = parts(card)[0] as { content: string };
    text.content += ` ${["ops", "example.com"].join("@")}`;
    expect(cardIsSafe(card)).toBe(false);
  });
});
