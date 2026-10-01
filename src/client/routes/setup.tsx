import { createFileRoute, notFound } from "@tanstack/react-router";
import { getMe, getSetupStatus } from "../lib/account/client";
import { AccountFrame } from "../lib/account/Frame";
import { setupHost } from "../lib/account/host";
import { Setup } from "../lib/account/Setup";

/**
 * First-run setup: the owner account while the instance has no account, then the first site. Its second
 * step also opens for a signed-in user who may create sites while the instance has none (setup left before
 * that step); a 404 page otherwise.
 */
export const Route = createFileRoute("/setup")({
  loader: async () => {
    const [status, where] = await Promise.all([getSetupStatus(), setupHost()]);
    if (status.needed) return { ...where, start: "owner" as const };
    if (where.site === null && (await getMe()).permissions.includes("instance.manage"))
      return { ...where, start: "site" as const };
    throw notFound();
  },
  head: () => ({ meta: [{ title: "Set up | Uptellis" }] }),
  component: () => {
    const { host, site, start } = Route.useLoaderData();
    return (
      <AccountFrame title="Set up Uptellis" intro="Two steps: the owner account, then the first site.">
        <Setup host={host} site={site} start={start} />
      </AccountFrame>
    );
  },
});
