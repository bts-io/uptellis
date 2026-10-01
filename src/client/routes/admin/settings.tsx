import { createFileRoute, getRouteApi, Link, Outlet } from "@tanstack/react-router";
import { allowed, SETTINGS_SECTIONS } from "../../lib/admin/nav";
import { PageHeader } from "../../lib/admin/PageHeader";

const admin = getRouteApi("/admin");

/**
 * Settings: a side menu of the sections the user's permissions open (top tabs on a phone), each a route of
 * its own below `/admin/settings/`.
 */
export const Route = createFileRoute("/admin/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const { me } = admin.useLoaderData();
  const sections = SETTINGS_SECTIONS.filter((s) => allowed(s.needs, me.permissions));
  return (
    <>
      <PageHeader title="Settings" subtitle="The power tools. You will rarely need them." />
      <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:items-start">
        <nav aria-label="Settings" className="overflow-x-auto [scrollbar-width:none] md:sticky md:top-4">
          <ul className="flex gap-1 border-b border-line whitespace-nowrap md:flex-col md:border-b-0 md:whitespace-normal">
            {sections.map((s) => (
              <li key={s.to}>
                <Link
                  to={s.to}
                  className="block border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-ink data-[status=active]:border-accent data-[status=active]:text-ink md:border-b-0 md:border-l-2 md:data-[status=active]:bg-raised"
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </>
  );
}
