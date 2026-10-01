import { createFileRoute, getRouteApi, Link } from "@tanstack/react-router";
import { allowed, SETTINGS_SECTIONS } from "../../../lib/admin/nav";

const admin = getRouteApi("/admin");

/** The Settings landing page: each section the user may open, with one line about it. */
export const Route = createFileRoute("/admin/settings/")({
  component: () => {
    const { me } = admin.useLoaderData();
    return (
      <ul className="grid gap-3 sm:grid-cols-2">
        {SETTINGS_SECTIONS.filter((s) => allowed(s.needs, me.permissions)).map((s) => (
          <li key={s.to}>
            <Link to={s.to} className="block h-full border border-line bg-panel p-4 hover:bg-raised">
              <span className="block font-semibold text-ink">{s.label}</span>
              <span className="mt-1 block text-sm text-muted">{s.about}</span>
            </Link>
          </li>
        ))}
      </ul>
    );
  },
});
