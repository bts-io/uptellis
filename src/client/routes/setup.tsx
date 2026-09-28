import { createFileRoute, notFound } from "@tanstack/react-router";
import { getSetupStatus } from "../lib/account/client";
import { AccountFrame } from "../lib/account/Frame";
import { setupHost } from "../lib/account/host";
import { Setup } from "../lib/account/Setup";

/** First-run setup: exists only while the instance has no account, a 404 page afterwards. */
export const Route = createFileRoute("/setup")({
  loader: async () => {
    if (!(await getSetupStatus()).needed) throw notFound();
    return setupHost();
  },
  head: () => ({ meta: [{ title: "Set up | Uptellis" }] }),
  component: () => {
    const { host, site } = Route.useLoaderData();
    return (
      <AccountFrame title="Set up Uptellis" intro="Two steps: the owner account, then the first site.">
        <Setup host={host} site={site} />
      </AccountFrame>
    );
  },
});
