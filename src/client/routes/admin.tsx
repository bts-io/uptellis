import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router";
import type { SiteView } from "@/shared/view";
import { getMe } from "../lib/account/client";
import { getConfig, orNotFound } from "../lib/admin/client";
import { AdminLayout } from "../lib/admin/Layout";
import { WELCOME_PATH } from "../lib/admin/monitors/firstRun";
import { buildRows } from "../lib/admin/monitors/model";
import { adminSite } from "../lib/admin/site";
import { api } from "../lib/api";

/**
 * `/admin` for the site this host serves. The page gate in src/worker/serve.ts sends a signed-out visitor
 * to sign-in and answers 404 to a user without an admin permission; the data comes from `/api/admin/*`
 * through `api()`, which checks each route's permission on client-side navigation too. The site view (for
 * the Monitors badge and dashboard) is loaded here, so every tab has it; a failed read leaves it null.
 */
export const Route = createFileRoute("/admin")({
  beforeLoad: async () => ({ site: await adminSite() }),
  loader: async ({ context }) => {
    const [state, me, view] = await Promise.all([
      getConfig(context.site).catch(orNotFound),
      getMe(),
      api<SiteView>(`/api/sites/${encodeURIComponent(context.site)}/view`).catch(() => null),
    ]);
    return { site: context.site, state, me, view };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `Admin | ${loaderData.site.toUpperCase()} status` : "Admin" }],
  }),
  component: AdminRoute,
});

function AdminRoute() {
  const { state, me, view } = Route.useLoaderData();
  const down = buildRows(state.config, view).filter((r) => r.state === "down").length;
  const bare = useLocation({ select: (l) => l.pathname === WELCOME_PATH });
  return (
    <AdminLayout siteName={state.config.name} me={me} downCount={down} bare={bare}>
      <Outlet />
    </AdminLayout>
  );
}
