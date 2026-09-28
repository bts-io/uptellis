// The one place the agent picks its check library: `runCheck` and the Bun transport (fetch, node:net,
// node:tls, the system `ping`) from src/checks, bundled into the binary. Everything else takes a `RunCheck`
// and a `CheckTransport` by injection, so tests pass fakes. The image copies src/checks
// (Dockerfile.dockerignore).
import { createBunTransport } from "../../src/checks/bun-transport.ts";
import type { CheckTransport } from "./shared";

export { runCheck as defaultRunCheck } from "../../src/checks/index.ts";

export const defaultTransport: CheckTransport = createBunTransport();
