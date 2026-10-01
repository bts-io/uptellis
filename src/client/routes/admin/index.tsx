import { createFileRoute, getRouteApi, useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { getUsers } from "../../lib/account/client";
import { getDeliveries } from "../../lib/admin/client";
import { MonitorsDashboard } from "../../lib/admin/monitors/Dashboard";
import type { ChecklistFacts } from "../../lib/admin/monitors/firstRun";
import { useLiveRefresh } from "../../lib/live";

const admin = getRouteApi("/admin");

/**
 * The Monitors dashboard, the admin's home; it refreshes itself like the status page does. A site that
 * watches nothing goes to the first-run screen; `?show=<service>` opens that service's details on arrival
 * (the monitor the first-run screen just added).
 */
export const Route = createFileRoute("/admin/")({
  validateSearch: (s: Record<string, unknown>): { show?: string } => ({
    show: typeof s.show === "string" ? s.show : undefined,
  }),
  component: MonitorsPage,
});

/** The delivery log and the user count for Getting started, read once in the browser (null when unreadable). */
function useChecklistFacts(site: string, canSeeUsers: boolean): Omit<ChecklistFacts, "testSent"> {
  const [facts, setFacts] = useState<Omit<ChecklistFacts, "testSent">>({ deliveries: null, users: null });
  useEffect(() => {
    let live = true;
    void Promise.all([
      getDeliveries(site, 50)
        .then((r) => r.deliveries)
        .catch(() => null),
      canSeeUsers
        ? getUsers()
            .then((r) => r.users.length)
            .catch(() => null)
        : Promise.resolve(null),
    ]).then(([deliveries, users]) => {
      if (live) setFacts({ deliveries, users });
    });
    return () => {
      live = false;
    };
  }, [site, canSeeUsers]);
  return facts;
}

function MonitorsPage() {
  const { site, state, view, me } = admin.useLoaderData();
  const { show } = Route.useSearch();
  const router = useRouter();
  const navigate = useNavigate();
  useLiveRefresh();
  const facts = useChecklistFacts(site, me.permissions.includes("users.manage"));
  // The details stay open; only the address loses `?show`, so a reload does not open them again.
  useEffect(() => {
    if (show) void navigate({ to: "/admin", search: {}, replace: true });
  }, [show, navigate]);
  const welcome = useCallback(() => void navigate({ to: "/admin/welcome", replace: true }), [navigate]);
  const [arrivedWith] = useState(show);
  return (
    <MonitorsDashboard
      site={site}
      state={state}
      view={view}
      onReload={() => void router.invalidate()}
      facts={facts}
      onNavigate={(to) => void navigate({ to })}
      initialDetail={arrivedWith}
      onWelcome={arrivedWith ? undefined : welcome}
    />
  );
}
