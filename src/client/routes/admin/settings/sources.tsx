import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { getApiKeys } from "../../../lib/account/client";
import { ApiKeys } from "../../../lib/admin/ApiKeys";
import { getSources, orNotFound } from "../../../lib/admin/client";
import { Sources } from "../../../lib/admin/Sources";
import { SettingsSection } from "../../../lib/admin/settings/Section";

const admin = getRouteApi("/admin");

/** Ingest sources with when each was last heard from and their keys, and the site's API keys. */
export const Route = createFileRoute("/admin/settings/sources")({
  loader: async ({ context }) => {
    const [sources, apiKeys] = await Promise.all([getSources(context.site), getApiKeys(context.site)]).catch(
      orNotFound,
    );
    return { sources, apiKeys };
  },
  component: () => {
    const { site, view } = admin.useLoaderData();
    const { sources, apiKeys } = Route.useLoaderData();
    const router = useRouter();
    const reload = () => void router.invalidate();
    const lastSeen = new Map(view?.freshness.perSource.map((s) => [s.id, s.lastSeenAt]) ?? []);
    return (
      <SettingsSection
        title="Sources and keys"
        subtitle="Where results come from besides our own checks. Each key lets one sender report in."
      >
        <Sources site={site} list={sources} lastSeen={lastSeen} onReload={reload} />
        <ApiKeys site={site} list={apiKeys} onReload={reload} />
      </SettingsSection>
    );
  },
});
