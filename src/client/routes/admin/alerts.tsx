import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { AlertsPage } from "../../lib/admin/alerts/AlertsPage";

const admin = getRouteApi("/admin");

/** Alerts: the site's alert channels as cards with an add and edit drawer, then the recent alerts. */
export const Route = createFileRoute("/admin/alerts")({
  component: () => {
    const { site, state, view } = admin.useLoaderData();
    const router = useRouter();
    return <AlertsPage site={site} state={state} view={view} onReload={() => void router.invalidate()} />;
  },
});
