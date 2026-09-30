import { describe, expect, it } from "vitest";
import { signRequest, verifyRequest } from "@/shared/signing";
import { randomSecret } from "@/worker/engine/seal";
import { routeAllows } from "@/worker/ingest/keys";

describe("ingest keys", () => {
  it("verifies a collector signature made with the trimmed key file against the issued secret", async () => {
    // Admin issues a base64url secret; the collector reads its key file with readFileSync(...).trim() and
    // signs with those UTF-8 bytes, so the file's trailing newline does not matter.
    const issued = randomSecret();
    const fileText = `${issued}\n`;
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
      keysFor: (id) => (id === "collector-1" ? [issued] : null),
    });
    expect(r).toMatchObject({ ok: true, keyId: "collector-1", keyIndex: 0 });
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
