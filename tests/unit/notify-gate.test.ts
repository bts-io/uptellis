import { describe, expect, it } from "vitest";
import { MaintenanceWindow } from "@/shared/monitors";
import { channelsOf, channelWants } from "@/shared/notify";
import { eventOf, inMaintenanceAtStart } from "@/worker/notify";

const window = MaintenanceWindow.parse({
  kind: "weekly",
  id: "backup",
  title: "Nightly backup",
  services: ["probe:web"],
  days: ["sun"],
  start: "02:00",
  durationMin: 60,
  timeZone: "Europe/Paris",
});
const config = (maintenance = [window]) => ({ maintenance });
// Sunday 2026-09-27 02:30 in Paris is 00:30 UTC.
const inside = { serviceId: "probe:web", startedAt: "2026-09-27T00:30:00Z" };
const outside = { serviceId: "probe:web", startedAt: "2026-09-27T01:30:00Z" };

describe("down gate", () => {
  it("names the event of each transition", () => {
    expect(eventOf("open", { kind: "down" })).toBe("down");
    expect(eventOf("resolve", { kind: "down" })).toBe("up");
    expect(eventOf("open", { kind: "stale" })).toBe("stale");
    expect(eventOf("resolve", { kind: "stale" })).toBe("recovered");
  });

  it("sends down and up on the historical channel only when notify.discord is on", () => {
    const [on] = channelsOf({ discord: true, channels: [] });
    const [off] = channelsOf({ discord: false, channels: [] });
    expect(channelWants(on!, "down", "probe:web")).toBe(true);
    expect(channelWants(on!, "up", "probe:web")).toBe(true);
    expect(channelWants(off!, "down", "probe:web")).toBe(false);
    expect(channelWants(off!, "up", "probe:web")).toBe(false);
    expect(channelWants(off!, "stale", null)).toBe(true);
  });

  it("suppresses the down of an incident that starts inside a window", () => {
    expect(inMaintenanceAtStart(config(), outside)).toBe(false);
    expect(inMaintenanceAtStart(config(), inside)).toBe(true);
    // Another service is not covered by this window.
    expect(inMaintenanceAtStart(config(), { ...inside, serviceId: "probe:api" })).toBe(false);
    // A window without services covers every service.
    const all = MaintenanceWindow.parse({ ...window, services: [] });
    expect(inMaintenanceAtStart(config([all]), { ...inside, serviceId: "kuma:7" })).toBe(true);
    // An unknown site has no windows.
    expect(inMaintenanceAtStart(null, inside)).toBe(false);
  });
});
