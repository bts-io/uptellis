import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { getRevisions, orNotFound } from "../../../lib/admin/client";
import { Revisions } from "../../../lib/admin/Revisions";

const admin = getRouteApi("/admin");

export const Route = createFileRoute("/admin/settings/revisions")({
  loader: ({ context }) => getRevisions(context.site).catch(orNotFound),
  component: () => {
    const { site } = admin.useLoaderData();
    const router = useRouter();
    return <Revisions site={site} list={Route.useLoaderData()} onReload={() => void router.invalidate()} />;
  },
});
