/** Test signing helpers. Secrets here are test-only strings, never real keys. */
import { signRequest } from "@/shared/signing";

export const TEST_KEYS = {
  "collector-1": "test-ingest-secret-collector-1",
  collectorNext: "test-ingest-secret-collector-1-next",
  "facts-1": "test-ingest-secret-facts-1",
  ci: "test-ingest-secret-ci",
} as const;

let counter = 0;
/** A unique 16-byte lower-case hex nonce, built at runtime. */
export const nextNonce = () => (++counter).toString(16).padStart(32, "0");

export interface SignedInit {
  keyId?: string;
  secret?: string;
  now?: Date;
  nonce?: string;
  path?: string;
  headers?: Record<string, string>;
}

/** A signed POST for `path` (the pathname the Worker sees). */
export async function signedPost(path: string, body: string, opts: SignedInit = {}): Promise<RequestInit> {
  const keyId = opts.keyId ?? "collector-1";
  const secret = opts.secret ?? TEST_KEYS[keyId as keyof typeof TEST_KEYS] ?? "unknown-test-secret";
  const headers = await signRequest(
    secret,
    keyId,
    "POST",
    opts.path ?? path,
    body,
    opts.now ?? new Date(),
    opts.nonce ?? nextNonce(),
  );
  return {
    method: "POST",
    body,
    headers: { "content-type": "application/json", ...headers, ...opts.headers },
  };
}
