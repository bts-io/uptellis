import { describe, expect, it } from "vitest";
import { type DisplayState, edgeState, type TopologyView } from "@/shared/view";

type Edge = TopologyView["edges"][number];

const edge = (over: Partial<Edge> = {}): Edge => ({
  from: "app-1",
  to: "app-2",
  kind: "replication",
  label: null,
  live: false,
  detail: null,
  ...over,
});
const nodes = (from: DisplayState, to: DisplayState) => [
  { id: "app-1", state: from },
  { id: "app-2", state: to },
];

describe("edgeState", () => {
  it("is live while the edge flows", () => {
    expect(edgeState(edge({ live: true }), nodes("unknown", "unknown"))).toBe("live");
    expect(edgeState(edge({ live: true, detail: "lag 0 s" }), nodes("up", "up"))).toBe("live");
  });

  it("is stopped when a profile says why, even with stale ends", () => {
    expect(edgeState(edge({ detail: "no standby streaming" }), nodes("up", "up"))).toBe("stopped");
    expect(edgeState(edge({ detail: "lag 0 s, 40 min ago" }), nodes("stale", "stale"))).toBe("stopped");
  });

  it("is stopped when an end node is down or degraded", () => {
    expect(edgeState(edge(), nodes("up", "down"))).toBe("stopped");
    expect(edgeState(edge(), nodes("degraded", "unknown"))).toBe("stopped");
  });

  it("is unknown when nothing reports on it", () => {
    expect(edgeState(edge(), nodes("unknown", "unknown"))).toBe("unknown");
    expect(edgeState(edge(), nodes("up", "stale"))).toBe("unknown");
    expect(edgeState(edge(), nodes("up", "up"))).toBe("unknown");
    expect(edgeState(edge(), [])).toBe("unknown");
  });
});
