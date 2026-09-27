import { describe, expect, it, vi } from "vitest";
import { staleCard } from "@/worker/notify/card";
import { MAX_RETRY_AFTER_S, postCard } from "@/worker/notify/send";

const HOOK = "https://discord.test/api/webhooks/1/test";
const card = staleCard({
  site: "demo",
  incident: {
    id: "kuma:watch-1:2026-09-27T10:05:00Z",
    site: "demo",
    kind: "stale",
    serviceId: null,
    sourceId: "kuma:watch-1",
    startedAt: "2026-09-27T10:05:00Z",
    endedAt: null,
    title: "Source kuma:watch-1 stale",
    notes: null,
  },
  sources: [],
  pageUrl: "https://status.example.com/",
  now: Date.parse("2026-09-27T10:06:00Z"),
});

const reply = (status: number, body: unknown = { id: "1" }) => Response.json(body, { status });

function mockFetch(...responses: (Response | Error)[]) {
  return vi.fn<typeof fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("unexpected call");
    if (next instanceof Error) throw next;
    return next;
  });
}

describe("postCard", () => {
  it("posts the card as JSON with wait and components, under a timeout", async () => {
    const fetch = mockFetch(reply(200));
    expect(await postCard(HOOK, card, { fetch })).toEqual({ ok: true, status: 200 });
    const [url, init] = fetch.mock.calls[0]!;
    const u = new URL(String(url));
    expect(u.origin + u.pathname).toBe(HOOK);
    expect(u.searchParams.get("wait")).toBe("true");
    expect(u.searchParams.get("with_components")).toBe("true");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual(card);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries a 429 once after Discord's retry_after", async () => {
    const fetch = mockFetch(reply(429, { retry_after: 1.5 }), reply(200));
    const sleep = vi.fn(async () => {});
    expect(await postCard(HOOK, card, { fetch, sleep })).toEqual({ ok: true, status: 200 });
    expect(sleep).toHaveBeenCalledWith(1500);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after the one retry", async () => {
    const fetch = mockFetch(reply(429, { retry_after: 0 }), reply(429, { retry_after: 0 }));
    const out = await postCard(HOOK, card, { fetch, sleep: async () => {} });
    expect(out).toEqual({ ok: false, status: 429, error: "rate_limited" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not wait out a long rate limit", async () => {
    const fetch = mockFetch(reply(429, { retry_after: MAX_RETRY_AFTER_S + 1 }));
    const sleep = vi.fn(async () => {});
    expect(await postCard(HOOK, card, { fetch, sleep })).toMatchObject({ ok: false, error: "rate_limited" });
    expect(sleep).not.toHaveBeenCalled();
  });

  it("reports other failures without retrying or throwing", async () => {
    expect(await postCard(HOOK, card, { fetch: mockFetch(reply(500, { message: "x" })) })).toEqual({
      ok: false,
      status: 500,
      error: "http_500",
    });
    expect(await postCard(HOOK, card, { fetch: mockFetch(reply(404)) })).toMatchObject({ error: "http_404" });
    const timeout = Object.assign(new Error("slow"), { name: "TimeoutError" });
    expect(await postCard(HOOK, card, { fetch: mockFetch(timeout) })).toEqual({
      ok: false,
      status: 0,
      error: "timeout",
    });
    expect(await postCard(HOOK, card, { fetch: mockFetch(new TypeError("reset")) })).toMatchObject({
      error: "network",
    });
    expect(await postCard("not a url", card, { fetch: mockFetch() })).toMatchObject({
      error: "bad_webhook_url",
    });
  });
});
