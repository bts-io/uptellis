import { createFileRoute, Outlet } from "@tanstack/react-router";
import { getConfig, orNotFound } from "../lib/admin/client";
import { AdminLayout } from "../lib/admin/Layout";
import { adminSite } from "../lib/admin/site";

/**
 * `/admin` for the site this host serves. The admin gate in src/worker/serve.ts guards the page; the data comes
 * from `/api/admin/*` through `api()`, which the same gate guards on client-side navigation too.
 */
export const Route = createFileRoute("/admin")({
  beforeLoad: async () => ({ site: await adminSite() }),
  loader: async ({ context }) => ({
    site: context.site,
    state: await getConfig(context.site).catch(orNotFound),
  }),
  head: ({ loaderData }) => ({
    meta: [{ title: loaderData ? `Admin | ${loaderData.site.toUpperCase()} status` : "Admin" }],
  }),
  component: AdminRoute,
});

function AdminRoute() {
  const { state } = Route.useLoaderData();
  return (
    <AdminLayout state={state}>
      <Outlet />
    </AdminLayout>
  );
}
