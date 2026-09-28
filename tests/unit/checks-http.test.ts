import { describe, expect, it, vi } from "vitest";
import { runCheck } from "@/checks";
import { KEYWORD_BODY_LIMIT } from "@/shared/monitors/check";
import { fakeTransport, monitor, options, transportError } from "../support/fake-check-transport";

type FetchInput = Parameters<typeof globalThis.fetch>[0];

const URL_HEALTH = "https://app.example.com/healthz";
const http = (over: Record<string, unknown> = {}) =>
  monitor({ type: "http", url: URL_HEALTH, runners: ["builtin"], ...over });

/** A fetch mock answering each call with the next status, and a body when given. */
function answering(statuses: number[], body: ConstructorParameters<typeof Response>[0] = "body") {
  let i = 0;
  return vi.fn(async (_url: FetchInput, _init?: RequestInit) => {
    const status = statuses[Math.min(i++, statuses.length - 1)]!;
    const redirect = status >= 300 && status < 400;
    return new Response(redirect ? null : body, {
      status,
      headers: redirect ? { location: "https://elsewhere.example.org/" } : {},
    });
  });
}

/** A body stream that records how much was pulled and whether it was cancelled. */
function trackedBody(chunks: string[]) {
  const state = { pulled: 0, cancelled: false };
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const c = chunks[state.pulled++];
      if (c === undefined) controller.close();
      else controller.enqueue(enc.encode(c));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

describe("runCheck http", () => {
  it("is up on a status in range, with the fetch options: manual redirects, user agent, no edge cache", async () => {
    const fetch = answering([200]);
    const r = await runCheck(
      http(),
      options(fakeTransport({ fetch: fetch as unknown as typeof globalThis.fetch })),
    );
    expect(r).toMatchObject({ status: "up", message: "HTTP 200" });
    expect(r.latencyMs).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(URL_HEALTH);
    expect(init).toMatchObject({
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": "uptellis/0.3.0" },
      cf: { cacheTtl: 0 },
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("measures latency to the headers", async () => {
    let clock = 1_000_000;
    const fetch = vi.fn(async () => {
      clock += 42;
      return new Response("ok");
    });
    const r = await runCheck(
      http(),
      options(fakeTransport({ fetch: fetch as unknown as typeof globalThis.fetch }), { now: () => clock }),
    );
    expect(r.latencyMs).toBe(42);
  });

  it("is down by status after the retry, with the latency of the answer", async () => {
    const fetch = answering([503]);
    const r = await runCheck(
      http(),
      options(fakeTransport({ fetch: fetch as unknown as typeof globalThis.fetch })),
    );
    expect(r).toMatchObject({ status: "down", message: "HTTP 503", latencyMs: 0 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("never follows a redirect: a 3xx is judged by its own status", async () => {
    const up = answering([301]);
    expect(
      await runCheck(http(), options(fakeTransport({ fetch: up as unknown as typeof globalThis.fetch }))),
    ).toMatchObject({ status: "up", message: "HTTP 301" });
    expect(up).toHaveBeenCalledTimes(1);
    const strict = answering([302]);
    const r = await runCheck(
      http({ expectStatus: { min: 200, max: 299 } }),
      options(fakeTransport({ fetch: strict as unknown as typeof globalThis.fetch })),
    );
    expect(r).toMatchObject({ status: "down", message: "HTTP 302" });
    expect(strict.mock.calls.map(([u, init]) => [u, init?.redirect])).toEqual([
      [URL_HEALTH, "manual"],
      [URL_HEALTH, "manual"],
    ]);
  });

  it("uses HEAD when configured and cancels the body unread", async () => {
    const { stream, state } = trackedBody(["never read"]);
    const fetch = vi.fn(async (_u: FetchInput, _i?: RequestInit) => new Response(stream, { status: 200 }));
    await runCheck(
      http({ method: "HEAD" }),
      options(fakeTransport({ fetch: fetch as unknown as typeof globalThis.fetch })),
    );
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "HEAD" });
    expect(state.cancelled).toBe(true);
  });

  it("maps a timeout and a failed connection to fixed words without the error text", async () => {
    for (const [kind, message] of [
      ["timeout", "timeout"],
      ["other", "connection failed"],
    ] as const) {
      const fetch = vi.fn(async () => {
        throw transportError(kind);
      });
      const r = await runCheck(
        http(),
        options(fakeTransport({ fetch: fetch as unknown as typeof globalThis.fetch })),
      );
      expect(r).toMatchObject({ status: "down", latencyMs: null, message });
    }
  });

  it("times out a hanging request after timeoutS through the abort signal", async () => {
    const fetch = vi.fn(
      (_u: FetchInput, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const r = await runCheck(
      http({ timeoutS: 1 }),
      options(fakeTransport({ fetch: fetch as unknown as typeof globalThis.fetch })),
    );
    expect(r).toMatchObject({ status: "down", latencyMs: null, message: "timeout" });
  });

  describe("keyword", () => {
    const run = async (
      over: Record<string, unknown>,
      body: ConstructorParameters<typeof Response>[0],
      status = 200,
    ) => {
      const fetch = answering([status], body);
      return runCheck(
        http(over),
        options(fakeTransport({ fetch: fetch as unknown as typeof globalThis.fetch })),
      );
    };

    it("is up when the keyword is present and down with `keyword missing` when not", async () => {
      expect(await run({ keyword: "All good" }, "<p>All good</p>")).toMatchObject({
        status: "up",
        message: "HTTP 200",
      });
      expect(await run({ keyword: "All good" }, "<p>all good</p>")).toMatchObject({
        status: "down",
        message: "keyword missing",
        latencyMs: 0,
      });
      expect(await run({ keyword: "All good" }, null)).toMatchObject({
        status: "down",
        message: "keyword missing",
      });
    });

    it("inverts with keywordAbsent: `keyword found` is down", async () => {
      expect(await run({ keyword: "Maintenance", keywordAbsent: true }, "normal page")).toMatchObject({
        status: "up",
        message: "HTTP 200",
      });
      expect(await run({ keyword: "Maintenance", keywordAbsent: true }, "Maintenance mode")).toMatchObject({
        status: "down",
        message: "keyword found",
      });
    });

    it("judges the status before the keyword", async () => {
      expect(await run({ keyword: "ok" }, "ok", 500)).toMatchObject({ status: "down", message: "HTTP 500" });
    });

    it("reads at most KEYWORD_BODY_LIMIT bytes, then cancels the rest", async () => {
      const chunk = "a".repeat(16 * 1024);
      const chunks = [
        ...Array.from({ length: 4 }, () => chunk),
        "NEEDLE",
        ...Array.from({ length: 50 }, () => chunk),
      ];
      const bodies: ReturnType<typeof trackedBody>[] = [];
      const fetch = vi.fn(async () => {
        const b = trackedBody(chunks);
        bodies.push(b);
        return new Response(b.stream, { status: 200 });
      });
      const r = await runCheck(
        http({ keyword: "NEEDLE" }),
        options(fakeTransport({ fetch: fetch as unknown as typeof globalThis.fetch })),
      );
      expect(KEYWORD_BODY_LIMIT).toBe(4 * chunk.length);
      expect(r).toMatchObject({ status: "down", message: "keyword missing" });
      expect(bodies).toHaveLength(2);
      for (const { state } of bodies) {
        expect(state.cancelled).toBe(true);
        expect(state.pulled).toBeLessThan(10);
      }
    });

    it("finds a keyword split across chunks, and multi-byte text", async () => {
      const { stream } = trackedBody(["status: all go", "od ✓"]);
      const fetch = vi.fn(async () => new Response(stream, { status: 200 }));
      const r = await runCheck(
        http({ keyword: "all good ✓" }),
        options(fakeTransport({ fetch: fetch as unknown as typeof globalThis.fetch })),
      );
      expect(r).toMatchObject({ status: "up" });
    });
  });
});
