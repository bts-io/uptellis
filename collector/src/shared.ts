// The one place the collector reaches into the app's shared code (payload schema, literal detector and the
// X-Uptellis-* request signer the Worker verifies with).
// Relative on purpose: works the same under `bun test`, `bun build` and inside the image, which copies
// `src/shared` next to the collector.
export {
  findForbiddenLiterals,
  type LiteralFinding,
  scrubForbiddenLiterals,
} from "../../src/shared/model/safety";
export type { CertSummary } from "../../src/shared/model/service";
export {
  INGEST_LIMITS,
  type KumaBeat,
  type KumaMonitor,
  KumaSnapshot,
  type KumaStatusCode,
} from "../../src/shared/schemas/ingest";
export {
  canonicalString,
  INGEST_HEADERS,
  randomNonce,
  type SignedHeaders,
  sha256Hex,
  signRequest,
} from "../../src/shared/signing";
