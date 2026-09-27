import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { getSources, orNotFound } from "../../lib/admin/client";
import { Sources } from "../../lib/admin/Sources";

const admin = getRouteApi("/admin");

export const Route = createFileRoute("/admin/sources")({
  loader: ({ context }) => getSources(context.site).catch(orNotFound),
  component: () => {
    const { site } = admin.useLoaderData();
    const router = useRouter();
    return <Sources site={site} list={Route.useLoaderData()} onReload={() => void router.invalidate()} />;
  },
});
