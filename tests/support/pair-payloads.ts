/**
 * Facts payloads of a forgejo-ha pair with a pusher on each node, as profiles/forgejo-ha/push-facts.sh sends
 * them (trimmed to the keys both nodes report): the same keys from both sides, for storage tests.
 */
import type { FactsPayload } from "@/shared/schemas";

export const PAIR_AT = "2026-09-27T23:45:00Z";

/** One node's payload: `role` and the disk percentage differ between the nodes. */
export function pairPayload(
  node: string,
  peer: string,
  role: "primary" | "standby",
  disk: number,
): FactsPayload {
  const fresh = 1800;
  return {
    v: 1,
    generatedAt: PAIR_AT,
    producer: node,
    groups: [
      {
        group: "forgejo",
        facts: [
          { key: "node", value: node, freshForS: fresh },
          { key: "serving", value: role === "primary", freshForS: fresh, severity: "ok" },
        ],
      },
      {
        group: "replication",
        facts: [
          { key: "role", value: role, freshForS: fresh },
          { key: "peer", value: peer, freshForS: fresh },
        ],
      },
      {
        group: "disk",
        facts: [{ key: "percent", value: disk, unit: "%", freshForS: fresh, severity: "ok" }],
      },
    ],
  };
}
