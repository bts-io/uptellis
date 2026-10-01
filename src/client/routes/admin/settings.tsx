import { createFileRoute, getRouteApi, Link, Outlet } from "@tanstack/react-router";
import { allowed, SETTINGS_SECTIONS } from "../../lib/admin/nav";
import { PageHeader } from "../../lib/admin/PageHeader";

const admin = getRouteApi("/admin");

/**
 * Settings (placeholder until its redesign): a sub-nav of the sections the user's permissions open, each a
 * route of its own below `/admin/settings/`.
 */
export const Route = createFileRoute("/admin/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  const { me } = admin.useLoaderData();
  const sections = SETTINGS_SECTIONS.filter((s) => allowed(s.needs, me.permissions));
  return (
    <>
      <PageHeader title="Settings" subtitle="Sources and keys, people, history and files." />
      <nav aria-label="Settings" className="mb-6 overflow-x-auto [scrollbar-width:none]">
        <ul className="flex gap-1 border-b border-line whitespace-nowrap">
          {sections.map((s) => (
            <li key={s.to}>
              <Link
                to={s.to}
                className="inline-block border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-ink data-[status=active]:border-accent data-[status=active]:text-ink"
              >
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}
