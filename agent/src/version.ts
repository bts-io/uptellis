// The agent's version: `--define AGENT_VERSION='"X.Y.Z"'` at build time (release builds pass the tag),
// else this package's version. It names the agent in every batch (`uptellis-agent/X.Y.Z`) and the checks'
// user agent.
import pkg from "../package.json" with { type: "json" };

declare const AGENT_VERSION: string | undefined;

export const VERSION: string =
  typeof AGENT_VERSION === "string" && /^[A-Za-z0-9.+-]{1,40}$/.test(AGENT_VERSION)
    ? AGENT_VERSION
    : pkg.version;

export const AGENT_NAME = `uptellis-agent/${VERSION}`;
