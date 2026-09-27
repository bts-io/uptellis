import { describe, expect, it } from "vitest";
import { parseSiteConfig } from "@/shared/config";
import { signRequest, verifyRequest } from "@/shared/signing";
import { INGEST_KEY_BINDINGS, ingestSecretName, routeAllows, secretsFor } from "@/worker/ingest/keys";
import demo from "../../sites/demo.json";

describe("ingest key bindings", () => {
  it("maps key ids to secret names", () => {
    expect(ingestSecretName("collector-1")).toBe("INGEST_KEY_COLLECTOR_1");
    expect(ingestSecretName("facts-1")).toBe("INGEST_KEY_FACTS_1");
    expect(ingestSecretName("forgejo-ha")).toBe("INGEST_KEY_FORGEJO_HA");
  });

  it("reads current then next secrets and ignores empty ones", () => {
    expect(
      secretsFor({ INGEST_KEY_COLLECTOR_1: "a", INGEST_KEY_COLLECTOR_1_NEXT: "b" }, "collector-1"),
    ).toEqual(["a", "b"]);
    expect(
      secretsFor({ INGEST_KEY_COLLECTOR_1: "", INGEST_KEY_COLLECTOR_1_NEXT: "b" }, "collector-1"),
    ).toEqual(["b"]);
    expect(secretsFor({ INGEST_KEY_FACTS_1: "a" }, "collector-1")).toEqual([]);
  });

  it("trims secrets like the producers do, and treats whitespace-only as unset", () => {
    expect(
      secretsFor(
        { INGEST_KEY_COLLECTOR_1: "a-secret\n", INGEST_KEY_COLLECTOR_1_NEXT: "  \n" },
        "collector-1",
      ),
    ).toEqual(["a-secret"]);
  });

  it("verifies a collector signature made with the trimmed key file against a secret stored with a newline", async () => {
    // The collector reads its key file with readFileSync(...).trim() and signs with those UTF-8 bytes.
    const fileText = "tëst-key-not-real\n";
    const body = '{"v":1}';
    const now = new Date("2026-09-27T23:58:00Z");
    const headers = new Headers(
      await signRequest(fileText.trim(), "collector-1", "POST", "/api/ingest/kuma", body, now),
    );
    const r = await verifyRequest({
      headers,
      method: "POST",
      path: "/api/ingest/kuma",
      body,
      now,
      keysFor: (id) => secretsFor({ INGEST_KEY_COLLECTOR_1: fileText }, id),
    });
    expect(r).toMatchObject({ ok: true, keyId: "collector-1", keyIndex: 0 });
  });

  it("binds every key to a source declared in sites/<site>.json", () => {
    const config = parseSiteConfig(demo);
    for (const b of Object.values(INGEST_KEY_BINDINGS)) {
      expect(b.site).toBe(config.slug);
      expect(config.sources.map((s) => s.id)).toContain(b.source);
    }
    expect(INGEST_KEY_BINDINGS["collector-1"]!.source).toBe("kuma:watch-1");
    expect(INGEST_KEY_BINDINGS["facts-1"]!.source).toBe("facts:app-1");
  });

  it("lets each route accept only its source kinds", () => {
    expect(routeAllows("kuma", "kuma:watch-1")).toBe(true);
    expect(routeAllows("kuma", "facts:app-1")).toBe(false);
    expect(routeAllows("facts", "kuma:watch-1")).toBe(false);
    expect(routeAllows("facts", "facts:app-1")).toBe(true);
    expect(routeAllows("events", "webhook:ci")).toBe(true);
    expect(routeAllows("events", "facts:app-1")).toBe(true);
    expect(routeAllows("events", "kuma:watch-1")).toBe(false);
  });
});
