/**
 * One attempt of an `http` monitor. A plain `fetch` of the configured URL with a timeout, no edge cache
 * (`cf.cacheTtl: 0`, ignored outside Workers) and redirects never followed, so a check only ever reaches the
 * URL in the config; a 3xx is judged by its own status. A status inside `expectStatus` is up (`HTTP 200`),
 * anything else down (`HTTP 503`). With a `keyword`, at most `KEYWORD_BODY_LIMIT` bytes of the body are
 * read and searched (case-sensitive) and the rest is cancelled; without one the body is cancelled unread.
 * Latency is the time to the response headers.
 */
import { KEYWORD_BODY_LIMIT } from "../shared/monitors/check";
import type { MonitorConfig } from "../shared/monitors/schema";
import { type Attempt, down, failureMessage } from "./attempt";

type Http = Extract<MonitorConfig, { type: "http" }>;

export interface HttpDeps {
  fetch: typeof fetch;
  version: string;
  now: () => number;
}

/** Reads the body up to `limit` bytes as text, then cancels the rest of the stream. */
async function readPrefix(body: ReadableStream<Uint8Array>, limit: number): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let read = 0;
  try {
    while (read < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.byteLength > limit - read ? value.subarray(0, limit - read) : value;
      read += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export async function httpAttempt(m: Http, deps: HttpDeps): Promise<Attempt> {
  const started = deps.now();
  try {
    const res = await deps.fetch(m.url, {
      method: m.method,
      redirect: "manual",
      signal: AbortSignal.timeout(m.timeoutS * 1000),
      headers: { "user-agent": `uptellis/${deps.version}` },
      cf: { cacheTtl: 0 },
    } as RequestInit);
    const latencyMs = Math.max(0, deps.now() - started);
    const message = `HTTP ${res.status}`;
    const inRange = res.status >= m.expectStatus.min && res.status <= m.expectStatus.max;
    if (!inRange || !m.keyword || m.method === "HEAD") {
      await res.body?.cancel().catch(() => {});
      return inRange ? { status: "up", latencyMs, message } : down(message, latencyMs);
    }
    // A keyword on an empty body is simply absent.
    const text = res.body ? await readPrefix(res.body, KEYWORD_BODY_LIMIT) : "";
    return keywordVerdict(m, text.includes(m.keyword), latencyMs, message);
  } catch (err) {
    return down(failureMessage(err));
  }
}

/** Up when the keyword is found (or, with `keywordAbsent`, when it is not); the up message stays `HTTP <status>`. */
function keywordVerdict(m: Http, found: boolean, latencyMs: number, upMessage: string): Attempt {
  if (found === !m.keywordAbsent) return { status: "up", latencyMs, message: upMessage };
  return down(found ? "keyword found" : "keyword missing", latencyMs);
}
