// Signs and POSTs one snapshot body. Returns the HTTP status only; response bodies are not logged.
import type { IngestConfig } from "./config";
import { signRequest } from "./shared";

export interface SendResult {
  ok: boolean;
  status: number;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function postSnapshot(
  cfg: IngestConfig,
  body: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 20_000,
): Promise<SendResult> {
  // The Worker's own signer (src/shared/signing.ts): key = UTF-8 bytes of the trimmed secret file text.
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "uptellis-collector/0.1",
    ...(await signRequest(cfg.key, cfg.keyId, "POST", cfg.path, body)),
  };
  if (cfg.accessClientId && cfg.accessClientSecret) {
    headers["CF-Access-Client-Id"] = cfg.accessClientId;
    headers["CF-Access-Client-Secret"] = cfg.accessClientSecret;
  }
  try {
    const res = await fetchImpl(cfg.url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel().catch(() => undefined);
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}
