import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { MonitorsDashboard } from "../../lib/admin/monitors/Dashboard";
import { useLiveRefresh } from "../../lib/live";

const admin = getRouteApi("/admin");

/** The Monitors dashboard, the admin's home; it refreshes itself like the status page does. */
export const Route = createFileRoute("/admin/")({
  component: MonitorsPage,
});

function MonitorsPage() {
  const { site, state, view } = admin.useLoaderData();
  const router = useRouter();
  useLiveRefresh();
  return (
    <MonitorsDashboard site={site} state={state} view={view} onReload={() => void router.invalidate()} />
  );
}
