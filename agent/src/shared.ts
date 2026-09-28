// The one place the agent reaches into the app's shared code: the monitor schema, the agent API and the
// check library interface (src/shared/monitors, the Phase 6 contract).
// Relative on purpose: works the same under `bun test`, `bun build --compile` and inside the image, which
// copies `src/shared` next to the agent.
export {
  AGENT_API_PREFIX,
  AgentId,
  AgentMonitorsResponse,
  type CheckOptions,
  CheckResult,
  type CheckTransport,
  MAX_RESULT_AGE_S,
  MAX_RESULTS_BYTES,
  MAX_RESULTS_PER_BATCH,
  type MonitorConfig,
  ResultsAccepted,
  type ResultsBatch,
  RUNNER_HEADER,
  type RunCheck,
} from "../../src/shared/monitors";
