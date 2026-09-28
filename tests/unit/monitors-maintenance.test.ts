import { describe, expect, it } from "vitest";
import { activeWindows, inMaintenance, MaintenanceWindow } from "@/shared/monitors";

type WindowInput = Parameters<typeof MaintenanceWindow.parse>[0];

const cfg = (...windows: WindowInput[]) => ({ maintenance: windows.map((w) => MaintenanceWindow.parse(w)) });

const weekly = (over: Record<string, unknown> = {}) =>
  cfg({
    kind: "weekly",
    id: "backup",
    title: "Nightly backup",
    days: ["sun"],
    start: "02:30",
    durationMin: 60,
    timeZone: "Europe/Paris",
    ...over,
  });

const at = (iso: string) => Date.parse(iso);

describe("once windows", () => {
  const c = cfg({
    kind: "once",
    id: "move",
    title: "Datacenter move",
    services: ["probe:web"],
    start: "2026-09-28T10:00:00Z",
    end: "2026-09-28T12:00:00Z",
  });

  it("is active from start (inclusive) to end (exclusive)", () => {
    expect(inMaintenance(c, "probe:web", at("2026-09-28T09:59:59Z"))).toBe(false);
    expect(inMaintenance(c, "probe:web", at("2026-09-28T10:00:00Z"))).toBe(true);
    expect(inMaintenance(c, "probe:web", at("2026-09-28T11:59:59Z"))).toBe(true);
    expect(inMaintenance(c, "probe:web", at("2026-09-28T12:00:00Z"))).toBe(false);
  });

  it("only covers the listed services", () => {
    expect(inMaintenance(c, "probe:api", at("2026-09-28T11:00:00Z"))).toBe(false);
  });

  it("reports the occurrence bounds", () => {
    expect(activeWindows(c, at("2026-09-28T11:00:00Z"))).toEqual([
      { window: c.maintenance[0], start: at("2026-09-28T10:00:00Z"), end: at("2026-09-28T12:00:00Z") },
    ]);
  });
});

describe("empty services", () => {
  it("covers every service of the site, of any source", () => {
    const c = weekly({ days: ["mon"], start: "00:00", durationMin: 24 * 60 });
    const now = at("2026-09-28T12:00:00Z"); // Monday
    for (const id of ["probe:web", "kuma:watch-1:42", "anything"])
      expect(inMaintenance(c, id, now)).toBe(true);
  });
});

describe("weekly windows", () => {
  it("uses the local time of the zone (summer, UTC+2)", () => {
    // Sunday 2026-09-27, 02:30 in Paris is 00:30 UTC.
    const c = weekly();
    expect(inMaintenance(c, "x", at("2026-09-27T00:29:59Z"))).toBe(false);
    expect(inMaintenance(c, "x", at("2026-09-27T00:30:00Z"))).toBe(true);
    expect(inMaintenance(c, "x", at("2026-09-27T01:29:59Z"))).toBe(true);
    expect(inMaintenance(c, "x", at("2026-09-27T01:30:00Z"))).toBe(false);
  });

  it("uses the local time of the zone (winter, UTC+1)", () => {
    // Sunday 2026-01-04, 02:30 in Paris is 01:30 UTC.
    const c = weekly();
    expect(inMaintenance(c, "x", at("2026-01-04T00:30:00Z"))).toBe(false);
    expect(inMaintenance(c, "x", at("2026-01-04T01:30:00Z"))).toBe(true);
  });

  it("skips days that are not listed", () => {
    const c = weekly({ days: ["sat"] });
    expect(inMaintenance(c, "x", at("2026-09-27T00:45:00Z"))).toBe(false);
  });

  it("crosses midnight into the next day, on the start day's schedule", () => {
    // Saturday 23:00 Paris for 3 h: runs to Sunday 02:00 local, though Sunday is not listed.
    const c = weekly({ days: ["sat"], start: "23:00", durationMin: 180 });
    const start = at("2026-09-26T21:00:00Z");
    expect(inMaintenance(c, "x", start - 1000)).toBe(false);
    expect(inMaintenance(c, "x", start)).toBe(true);
    expect(inMaintenance(c, "x", at("2026-09-26T23:30:00Z"))).toBe(true); // Sunday 01:30 local
    expect(inMaintenance(c, "x", at("2026-09-27T00:00:00Z"))).toBe(false); // Sunday 02:00 local
    // A Friday start does not run into Saturday night.
    expect(inMaintenance(weekly({ days: ["fri"], start: "23:00", durationMin: 180 }), "x", start)).toBe(
      false,
    );
  });

  it("runs a full-day window through the next midnight", () => {
    const c = weekly({ days: ["sun"], start: "12:00", durationMin: 24 * 60 });
    expect(inMaintenance(c, "x", at("2026-09-28T09:59:00Z"))).toBe(true); // Monday 11:59 local
    expect(inMaintenance(c, "x", at("2026-09-28T10:00:00Z"))).toBe(false);
  });

  it("never matches an unknown time zone", () => {
    const c = weekly({ timeZone: "Mars/Olympus", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] });
    expect(activeWindows(c, at("2026-09-27T00:45:00Z"))).toEqual([]);
  });
});

describe("DST switch days", () => {
  it("Europe/Paris spring forward: a start in the gap moves forward by the gap", () => {
    // 2026-03-29 02:00 -> 03:00 local (01:00 UTC). 02:30 never happens; the window starts at 03:30 local
    // (01:30 UTC) and lasts 60 real minutes.
    const c = weekly();
    expect(inMaintenance(c, "x", at("2026-03-29T01:29:59Z"))).toBe(false);
    expect(inMaintenance(c, "x", at("2026-03-29T01:30:00Z"))).toBe(true);
    expect(inMaintenance(c, "x", at("2026-03-29T02:29:59Z"))).toBe(true);
    expect(inMaintenance(c, "x", at("2026-03-29T02:30:00Z"))).toBe(false);
  });

  it("Europe/Paris spring forward: a start after the switch uses the new offset", () => {
    const c = weekly({ start: "04:00" });
    // 04:00 CEST is 02:00 UTC.
    expect(inMaintenance(c, "x", at("2026-03-29T01:59:59Z"))).toBe(false);
    expect(inMaintenance(c, "x", at("2026-03-29T02:00:00Z"))).toBe(true);
  });

  it("Europe/Paris fall back: an ambiguous start uses the first occurrence", () => {
    // 2026-10-25 03:00 -> 02:00 local (01:00 UTC). 02:30 happens at 00:30 UTC and again at 01:30 UTC.
    const c = weekly();
    expect(inMaintenance(c, "x", at("2026-10-25T00:29:59Z"))).toBe(false);
    expect(inMaintenance(c, "x", at("2026-10-25T00:30:00Z"))).toBe(true);
    expect(inMaintenance(c, "x", at("2026-10-25T01:29:59Z"))).toBe(true);
    expect(inMaintenance(c, "x", at("2026-10-25T01:30:00Z"))).toBe(false);
  });

  it("Europe/Paris fall back: a window over the switch lasts its real duration", () => {
    // Saturday 23:00 CEST (21:00 UTC) for 6 h ends 03:00 UTC, which is 04:00 CET local.
    const c = weekly({ days: ["sat"], start: "23:00", durationMin: 360 });
    const [w] = activeWindows(c, at("2026-10-25T02:00:00Z"));
    expect(w).toMatchObject({ start: at("2026-10-24T21:00:00Z"), end: at("2026-10-25T03:00:00Z") });
  });

  it("America/New_York spring forward: 02:30 starts at 03:30 EDT", () => {
    // 2026-03-08 02:00 EST -> 03:00 EDT (07:00 UTC). 03:30 EDT is 07:30 UTC.
    const c = weekly({ timeZone: "America/New_York", durationMin: 30 });
    expect(inMaintenance(c, "x", at("2026-03-08T07:29:59Z"))).toBe(false);
    expect(inMaintenance(c, "x", at("2026-03-08T07:30:00Z"))).toBe(true);
    expect(inMaintenance(c, "x", at("2026-03-08T08:00:00Z"))).toBe(false);
  });

  it("America/New_York fall back: 01:30 uses the first (EDT) occurrence", () => {
    // 2026-11-01 02:00 EDT -> 01:00 EST (06:00 UTC). 01:30 EDT is 05:30 UTC, 01:30 EST is 06:30 UTC.
    const c = weekly({ timeZone: "America/New_York", start: "01:30", durationMin: 30 });
    expect(inMaintenance(c, "x", at("2026-11-01T05:29:59Z"))).toBe(false);
    expect(inMaintenance(c, "x", at("2026-11-01T05:30:00Z"))).toBe(true);
    expect(inMaintenance(c, "x", at("2026-11-01T06:00:00Z"))).toBe(false);
    expect(inMaintenance(c, "x", at("2026-11-01T06:30:00Z"))).toBe(false);
  });

  it("America/New_York: an evening window crossing midnight on the fall-back night", () => {
    // Saturday 2026-10-31 22:00 EDT (02:00 UTC Sunday) for 5 h ends 07:00 UTC, i.e. 02:00 EST.
    const c = weekly({ timeZone: "America/New_York", days: ["sat"], start: "22:00", durationMin: 300 });
    expect(inMaintenance(c, "x", at("2026-11-01T01:59:59Z"))).toBe(false);
    expect(inMaintenance(c, "x", at("2026-11-01T06:59:59Z"))).toBe(true);
    expect(inMaintenance(c, "x", at("2026-11-01T07:00:00Z"))).toBe(false);
  });
});

describe("activeWindows", () => {
  it("lists every active window in config order", () => {
    const c = cfg(
      {
        kind: "once",
        id: "a",
        title: "A",
        start: "2026-09-28T00:00:00Z",
        end: "2026-09-29T00:00:00Z",
      },
      { kind: "once", id: "b", title: "B", start: "2026-09-20T00:00:00Z", end: "2026-09-21T00:00:00Z" },
      {
        kind: "weekly",
        id: "c",
        title: "C",
        days: ["mon"],
        start: "13:00",
        durationMin: 120,
        timeZone: "Europe/Paris",
      },
    );
    expect(activeWindows(c, at("2026-09-28T11:30:00Z")).map((a) => a.window.id)).toEqual(["a", "c"]);
  });
});
