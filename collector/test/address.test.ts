import { describe, expect, it, spyOn } from "bun:test";
import {
  applyAliases,
  findLiteralPaths,
  parseHostAliases,
  sanitizeText,
  stripUrlCredentials,
} from "../src/address";
import { BeatBuffer } from "../src/buffer";
import { Collector } from "../src/collector";
import { buildSnapshot, guardSnapshot } from "../src/snapshot";
import { applyMonitorList, createState } from "../src/state";
import { ADDR, HOST_ALIASES_JSON, ip4, monitorList, NOW } from "./fixtures/kuma-events";

const aliases = parseHostAliases(HOST_ALIASES_JSON);

describe("HOST_ALIASES", () => {
  it("parses an address -> host map", () => {
    expect(aliases.get(ADDR.app1)).toBe("app-1");
    expect(parseHostAliases(undefined).size).toBe(0);
    expect(parseHostAliases("").size).toBe(0);
  });

  it("rejects malformed values without echoing them", () => {
    for (const bad of ["{", "[]", JSON.stringify({ x: 3 }), JSON.stringify({ a: "Not A Host" })]) {
      expect(() => parseHostAliases(bad)).toThrow(/HOST_ALIASES/);
    }
    try {
      parseHostAliases(JSON.stringify({ [ADDR.app1]: ADDR.app2 }));
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as Error).message).not.toContain(ADDR.app2);
    }
  });
});

describe("address mapping", () => {
  it("replaces known addresses at word boundaries only", () => {
    const longer = ip4(192, 0, 2, 100); // shares the prefix of ADDR.app1
    expect(applyAliases(`${ADDR.app1}:5432`, aliases)).toBe("app-1:5432");
    expect(applyAliases(`ping ${ADDR.app1}.`, aliases)).toBe("ping app-1.");
    expect(applyAliases(longer, aliases)).toBe(longer);
    expect(sanitizeText(`to ${longer}`, aliases)).toBe("to [redacted]");
  });

  it("maps bracketed IPv6 in URLs", () => {
    expect(applyAliases(`http://[${ADDR.v6}]:8080/x`, aliases)).toBe("http://host-v6:8080/x");
  });

  it("scrubs unknown addresses, emails and tokens", () => {
    const email = ["ops", "example.com"].join("@");
    expect(sanitizeText(`host ${ADDR.stray} mail ${email}`, aliases)).toBe("host [redacted] mail [redacted]");
  });

  it("drops URL credentials", () => {
    expect(stripUrlCredentials(`https://${["u:p", "h.example.com"].join("@")}/x`)).toBe(
      "https://h.example.com/x",
    );
    expect(stripUrlCredentials("https://h.example.com/a@b")).toBe("https://h.example.com/a@b");
  });
});

describe("fail closed", () => {
  it("reports field paths of leftover literals, never values", () => {
    const state = createState();
    applyMonitorList(state, monitorList(), true, NOW.getTime());
    const snap = buildSnapshot(state, NOW, { host: "watch-1", aliases });
    // Simulate a mapping bug: put a raw address back after sanitizing.
    snap.monitors[2]!.hostname = ADDR.app1;
    snap.monitors[4]!.name = `Standby ${ADDR.app2}`;
    const g = guardSnapshot(snap);
    expect(g.ok).toBe(false);
    if (g.ok) return;
    expect(g.literalPaths).toEqual(["$.monitors[2].hostname", "$.monitors[4].name"]);
    expect(JSON.stringify(g)).not.toContain(ADDR.app1);
    expect(JSON.stringify(g)).not.toContain(ADDR.app2);
  });

  it("finds literals in nested arrays and keys", () => {
    expect(findLiteralPaths({ a: [{ b: "ok" }, { c: ADDR.stray }], [ADDR.stray]: 1 })).toEqual([
      "$.a[1].c",
      "$.<key>",
    ]);
  });

  it("the collector refuses to send a snapshot the schema rejects, logging paths only", async () => {
    const state = createState();
    applyMonitorList(state, monitorList(), true, NOW.getTime());
    let fetched = 0;
    const lines: string[] = [];
    const spy = spyOn(process.stderr, "write").mockImplementation((s: string | Uint8Array) => {
      lines.push(String(s));
      return true;
    });
    try {
      const c = new Collector({
        state,
        session: { refresh: async () => undefined, status: () => ({ reachable: true }) },
        host: "Not_A_Host_Label",
        aliases,
        buffer: new BeatBuffer(),
        ingest: {
          url: "https://status.example.com/api/ingest/kuma",
          path: "/api/ingest/kuma",
          keyId: "collector-1",
          key: "k",
          accessClientId: null,
          accessClientSecret: null,
        },
        fetchImpl: async () => {
          fetched++;
          return new Response("{}");
        },
        livenessFile: null,
      });
      expect((await c.tick()).kind).toBe("refused");
    } finally {
      spy.mockRestore();
    }
    expect(fetched).toBe(0);
    const refused = lines.find((l) => l.includes("snapshot.refused"));
    expect(refused).toBeDefined();
    expect(refused).toContain("host");
    expect(refused).not.toContain("Not_A_Host_Label");
  });
});
