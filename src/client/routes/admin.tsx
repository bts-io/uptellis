import { createFileRoute, Outlet } from "@tanstack/react-router";
import { getMe } from "../lib/account/client";
import { getConfig, orNotFound } from "../lib/admin/client";
import { AdminLayout } from "../lib/admin/Layout";
import { adminSite } from "../lib/admin/site";

/**
 * `/admin` for the site this host serves. The page gate in src/server.ts sends a signed-out visitor to
 * sign-in and answers 404 to a user without an admin permission; the data comes from `/api/admin/*`
 * through `api()`, which checks each route's permission on client-side navigation too.
 */
export const Route = createFileRoute("/admin")({
  beforeLoad: async () => ({ site: await adminSite() }),
  loader: async ({ context }) => {
    const [state, me] = await Promise.all([getConfig(context.site).catch(orNotFound), getMe()]);
    return { site: context.site, state, me };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `Admin | ${loaderData.site.toUpperCase()} status` : "Admin" }],
  }),
  component: AdminRoute,
});

function AdminRoute() {
  const { state, me } = Route.useLoaderData();
  return (
    <AdminLayout state={state} me={me}>
      <Outlet />
    </AdminLayout>
  );
}
