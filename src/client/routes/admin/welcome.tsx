import { createFileRoute, getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";
import { FirstRun } from "../../lib/admin/monitors/FirstRun";
import { skipWelcome } from "../../lib/admin/monitors/firstRun";

const admin = getRouteApi("/admin");

/**
 * The first-run screen, "What should we watch?": the dashboard sends a site that watches nothing here (unless
 * it was skipped in this browser), setup lands here, and the Getting started card links back to it.
 */
export const Route = createFileRoute("/admin/welcome")({
  component: WelcomePage,
});

function WelcomePage() {
  const { site, state } = admin.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  return (
    <FirstRun
      site={site}
      state={state}
      onReload={() => void router.invalidate()}
      // A full load of the dashboard: the admin's loader data was read before this save, and the dashboard
      // must already know the monitor it opens (a one-time step, so the page load costs nothing).
      onDone={(serviceId) => window.location.assign(`/admin?show=${encodeURIComponent(serviceId)}`)}
      onSkip={() => {
        skipWelcome(site);
        void navigate({ to: "/admin" });
      }}
    />
  );
}
