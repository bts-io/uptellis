import { describe, expect, it } from "vitest";
import { MaintenanceWindow } from "@/shared/monitors";
import { downCardBlock } from "@/worker/notify";

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
const config = (discord: boolean, maintenance = [window]) => ({
  notify: { discord, webhooks: [], channels: [] },
  maintenance,
});
// Sunday 2026-09-27 02:30 in Paris is 00:30 UTC.
const inside = { serviceId: "probe:web", startedAt: "2026-09-27T00:30:00Z" };
const outside = { serviceId: "probe:web", startedAt: "2026-09-27T01:30:00Z" };

describe("down card gate", () => {
  it("sends when the site enables Discord and the service is not in maintenance", () => {
    expect(downCardBlock(config(true), "open", outside)).toBeNull();
    expect(downCardBlock(config(true), "resolve", outside)).toBeNull();
  });

  it("follows notify.discord, and sends nothing for an unknown site", () => {
    expect(downCardBlock(config(false), "open", outside)).toBe("notify_off");
    expect(downCardBlock(config(false), "resolve", outside)).toBe("notify_off");
    expect(downCardBlock(null, "open", outside)).toBe("notify_off");
  });

  it("suppresses the down card of an incident that starts inside a window", () => {
    expect(downCardBlock(config(true), "open", inside)).toBe("maintenance");
    // Another service is not covered by this window.
    expect(downCardBlock(config(true), "open", { ...inside, serviceId: "probe:api" })).toBeNull();
    // A window without services covers every service.
    const all = MaintenanceWindow.parse({ ...window, services: [] });
    expect(downCardBlock(config(true, [all]), "open", { ...inside, serviceId: "kuma:7" })).toBe(
      "maintenance",
    );
  });

  it("leaves the up card to the open card's claim, not to the window", () => {
    // Resolving inside a window still sends once the down card went out (checked by the notifier).
    expect(downCardBlock(config(true), "resolve", inside)).toBeNull();
  });
});
