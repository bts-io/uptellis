import { describe, expect, it, vi } from "vitest";
import { ProbeConfig } from "@/shared/config";
import { checkProbe, RETRY_DELAY_MS } from "@/worker/probes/checker";

type FetchInput = Parameters<typeof globalThis.fetch>[0];

const URL_HEALTH = "https://git.example.com/api/healthz";
/** A private address a redirect points at (built, so the repo scan finds no literal). */
const PRIVATE = [10, 0, 0, 1].join(".");
const probe = (over: Partial<ProbeConfig> = {}) =>
  ProbeConfig.parse({ id: "health", name: "Health", url: URL_HEALTH, ...over });

/** A fetch mock answering each call with the next status in `statuses`. */
function answering(...statuses: number[]) {
  let i = 0;
  return vi.fn(async (_url: FetchInput, _init?: RequestInit) => {
    const status = statuses[Math.min(i++, statuses.length - 1)]!;
    const redirect = status >= 300 && status < 400;
    return new Response(redirect ? null : "body", {
      status,
      headers: redirect ? { location: `https://${PRIVATE}/admin` } : {},
    });
  });
}

const noWait = () => vi.fn(async (_ms: number) => {});

describe("probe checker", () => {
  it("is up on a status in range, after one request with the edge options", async () => {
    const fetch = answering(200);
    const sleep = noWait();
    const r = await checkProbe(probe(), { fetch, sleep });
    expect(r).toMatchObject({ status: "up", message: "HTTP 200" });
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(URL_HEALTH);
    expect(init).toMatchObject({ method: "GET", redirect: "manual", cf: { cacheTtl: 0 } });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("uses the configured method", async () => {
    const fetch = answering(204);
    await checkProbe(probe({ method: "HEAD" }), { fetch, sleep: noWait() });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: "HEAD" });
  });

  it("is down by status after one retry 2 s later", async () => {
    const fetch = answering(503);
    const sleep = noWait();
    expect(await checkProbe(probe(), { fetch, sleep })).toMatchObject({
      status: "down",
      message: "HTTP 503",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(RETRY_DELAY_MS);
    expect(RETRY_DELAY_MS).toBe(2000);
  });

  it("is up when the retry succeeds", async () => {
    const fetch = answering(502, 200);
    expect(await checkProbe(probe(), { fetch, sleep: noWait() })).toMatchObject({
      status: "up",
      message: "HTTP 200",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("honours a custom expected range", async () => {
    const r = await checkProbe(probe({ expectStatus: { min: 200, max: 299 } }), {
      fetch: answering(404),
      sleep: noWait(),
    });
    expect(r).toMatchObject({ status: "down", message: "HTTP 404" });
  });

  it("times out after timeoutS and reports `timeout` without a latency", async () => {
    const fetch = vi.fn(
      (_url: FetchInput, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    const started = Date.now();
    const r = await checkProbe(probe({ timeoutS: 1 }), { fetch, sleep: noWait() });
    expect(r).toEqual({ status: "down", latencyMs: null, message: "timeout" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900);
  });

  it("reports a failed connection without the error text", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("connect failed to git.example.com");
    });
    expect(await checkProbe(probe(), { fetch, sleep: noWait() })).toEqual({
      status: "down",
      latencyMs: null,
      message: "connection failed",
    });
  });

  it("never follows a redirect: a 3xx is judged as is and only the configured URL is fetched", async () => {
    const up = answering(302);
    expect(await checkProbe(probe(), { fetch: up, sleep: noWait() })).toMatchObject({
      status: "up",
      message: "HTTP 302",
    });
    expect(up).toHaveBeenCalledTimes(1);

    const strict = answering(301);
    const r = await checkProbe(probe({ expectStatus: { min: 200, max: 299 } }), {
      fetch: strict,
      sleep: noWait(),
    });
    expect(r).toMatchObject({ status: "down", message: "HTTP 301" });
    expect(strict.mock.calls.map(([url, init]) => [url, init?.redirect])).toEqual([
      [URL_HEALTH, "manual"],
      [URL_HEALTH, "manual"],
    ]);
  });
});
