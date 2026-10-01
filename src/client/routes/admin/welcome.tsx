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
      onDone={(serviceId) => void navigate({ to: "/admin", search: { show: serviceId } })}
      onSkip={() => {
        skipWelcome(site);
        void navigate({ to: "/admin" });
      }}
    />
  );
}
