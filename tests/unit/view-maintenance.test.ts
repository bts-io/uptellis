import { describe, expect, it } from "vitest";
import { MaintenanceWindow } from "../../src/shared/monitors";
import { buildSiteView, type ServiceView, type SiteView, type ViewInput } from "../../src/shared/view";
import { fixtureInput } from "../fixtures/view";

const svc = (v: SiteView, id: string): ServiceView =>
  [...v.sections.flatMap((s) => s.services), ...v.unsectioned].find((s) => s.id === id)!;

function withWindows(name: "incident" | "stale", ...windows: Record<string, unknown>[]): ViewInput {
  const input = fixtureInput(name);
  return {
    ...input,
    config: { ...input.config, maintenance: windows.map((w) => MaintenanceWindow.parse(w)) },
  };
}

// The incident fixture's `now` is 2026-09-27T23:58:00Z; kuma:5 is down in it.
const once = (services: string[]) => ({
  kind: "once",
  id: "switch",
  title: "Switch replacement",
  services,
  start: "2026-09-27T23:00:00Z",
  end: "2026-09-28T01:00:00Z",
});

describe("maintenance in the view", () => {
  it("shows a covered service as maintenance whatever its stored status", () => {
    const input = withWindows("incident", once(["kuma:5"]));
    const v = buildSiteView(input);
    expect(svc(v, "kuma:5")).toMatchObject({ status: "maintenance", state: "maintenance" });
    expect(svc(v, "kuma:1").state).toBe("up");
    expect(v.verdict.state).toBe("operational");
    expect(v.summary).toMatchObject({ down: 0, maintenance: 1 });
    // The stored model is untouched.
    expect(input.model.services.find((s) => s.id === "kuma:5")?.status).toBe("down");
  });

  it("covers every service when the window lists none", () => {
    const v = buildSiteView(withWindows("incident", once([])));
    expect(v.summary.maintenance).toBe(v.summary.total);
  });

  it("outranks a stale source", () => {
    const input = withWindows("stale", once([]));
    const before = buildSiteView(fixtureInput("stale"));
    const stale = [...before.sections.flatMap((s) => s.services), ...before.unsectioned].find(
      (s) => s.state === "stale",
    );
    expect(stale).toBeDefined();
    input.config.maintenance[0] = MaintenanceWindow.parse({
      ...once([stale!.id]),
      start: "2026-09-28T00:00:00Z",
      end: "2026-09-28T02:00:00Z",
    });
    expect(svc(buildSiteView(input), stale!.id).state).toBe("maintenance");
  });

  it("drops the stale verdict while a window covers the whole site, and only then", () => {
    const window = (services: string[]) =>
      withWindows("stale", { ...once(services), start: "2026-09-28T00:00:00Z", end: "2026-09-28T02:00:00Z" });
    const before = buildSiteView(fixtureInput("stale"));
    expect(before.verdict.state).toBe("stale");
    expect(before.freshness.quietForMaintenance).toBeUndefined();

    const site = buildSiteView(window([]));
    expect(site.freshness).toMatchObject({ state: "stale", quietForMaintenance: true });
    expect(site.verdict.state).not.toBe("stale");

    const one = buildSiteView(window(["kuma:1"]));
    expect(one.verdict.state).toBe("stale");
    expect(one.freshness.quietForMaintenance).toBeUndefined();
  });

  it("lists the active windows with the current occurrence", () => {
    const v = buildSiteView(
      withWindows("incident", once(["kuma:5"]), {
        kind: "weekly",
        id: "backup",
        title: "Nightly backup",
        days: ["mon"],
        start: "01:30",
        durationMin: 60,
        timeZone: "Europe/Paris",
      }),
    );
    // The weekly window starts Monday 01:30 Paris (23:30 UTC Sunday).
    expect(v.maintenance).toEqual([
      {
        id: "switch",
        title: "Switch replacement",
        services: ["kuma:5"],
        start: "2026-09-27T23:00:00Z",
        end: "2026-09-28T01:00:00Z",
      },
      {
        id: "backup",
        title: "Nightly backup",
        services: [],
        start: "2026-09-27T23:30:00Z",
        end: "2026-09-28T00:30:00Z",
      },
    ]);
  });

  it("is empty outside every window", () => {
    const v = buildSiteView(withWindows("incident", { ...once([]), end: "2026-09-27T23:30:00Z" }));
    expect(v.maintenance).toEqual([]);
    expect(svc(v, "kuma:5").state).toBe("down");
  });
});
