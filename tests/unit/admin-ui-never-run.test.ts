import { describe, expect, it } from "vitest";
import { buildRows, statsOf, viewServices } from "@/client/lib/admin/monitors/model";
import { buildSiteView, type ServiceView, type SiteView } from "@/shared/view";
import { neverRunInput as input } from "../fixtures/never-run";

// The Monitors dashboard lists every configured monitor; with the view showing monitors that never ran
// (paused or pending), its rows and big numbers agree with the page.

const svc = (v: SiteView, id: string): ServiceView =>
  [...v.sections.flatMap((s) => s.services), ...v.unsectioned].find((s) => s.id === id)!;

describe("the admin dashboard agrees with the view", () => {
  const i = input();
  const v = buildSiteView(i);
  const rows = buildRows(i.config, v);

  it("lists the paused and pending monitors with the view's states", () => {
    const state = (id: string) => rows.find((r) => r.serviceId === id)!.state;
    expect(state("probe:lab-ping")).toBe("paused");
    expect(state("probe:lab-ssh")).toBe("paused");
    expect(state("probe:new-api")).toBe("pending");
    for (const r of rows) expect(r.state, r.serviceId).toBe(svc(v, r.serviceId).state);
  });

  it("counts as the view does: the Paused number, total, up and down", () => {
    const shown = viewServices(v);
    const stats = statsOf(rows);
    expect(stats.paused).toBe(shown.filter((s) => s.state === "paused").length);
    expect(stats.paused).toBe(2);
    expect(stats.total).toBe(v.summary.total);
    expect(stats.up).toBe(v.summary.up);
    expect(stats.down).toBe(v.summary.down);
  });
});
