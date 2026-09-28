import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { getApiKeys } from "../../lib/account/client";
import { ApiKeys } from "../../lib/admin/ApiKeys";
import { getSources, orNotFound } from "../../lib/admin/client";
import { Sources } from "../../lib/admin/Sources";

const admin = getRouteApi("/admin");

/** Ingest sources with their HMAC keys, and the site's API keys. */
export const Route = createFileRoute("/admin/sources")({
  loader: async ({ context }) => {
    const [sources, apiKeys] = await Promise.all([getSources(context.site), getApiKeys(context.site)]).catch(
      orNotFound,
    );
    return { sources, apiKeys };
  },
  component: () => {
    const { site } = admin.useLoaderData();
    const { sources, apiKeys } = Route.useLoaderData();
    const router = useRouter();
    const reload = () => void router.invalidate();
    return (
      <div className="flex flex-col gap-6">
        <Sources site={site} list={sources} onReload={reload} />
        <ApiKeys site={site} list={apiKeys} onReload={reload} />
      </div>
    );
  },
});
