// Monitors with no service row yet (buildSiteView shows them from the config): two paused ones, as a
// sleeping machine's ping and SSH, in a `lab` section, and an enabled one before its first check, unsectioned.

import { MonitorConfig } from "../../src/shared/monitors";
import type { ViewInput } from "../../src/shared/view";
import { fixtureInput } from "./view";

export const pausedPing = MonitorConfig.parse({
  id: "lab-ping",
  name: "Lab machine ping",
  type: "ping",
  host: "lab.example.com",
  runners: ["office-1"],
  enabled: false,
});
export const pausedSsh = MonitorConfig.parse({
  id: "lab-ssh",
  name: "Lab machine SSH",
  type: "tcp",
  host: "lab.example.com",
  port: 22,
  runners: ["office-1"],
  enabled: false,
});
export const neverRunHttp = MonitorConfig.parse({
  id: "new-api",
  name: "New API",
  type: "http",
  url: "https://api.example.org/v2",
});

/** The fixture `name` with the three monitors, the paused two in a `lab` section, `edit` applied. */
export function neverRunInput(
  name: "default" | "stale" | "incident" = "default",
  edit: (i: ViewInput) => void = () => {},
) {
  const i = fixtureInput(name);
  i.config = {
    ...i.config,
    monitors: [pausedPing, pausedSsh, neverRunHttp],
    sections: [
      ...i.config.sections,
      { id: "lab", title: "Lab", services: ["probe:lab-ping", "probe:lab-ssh"] },
    ],
  };
  edit(i);
  return i;
}
