import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { getRevisions, orNotFound } from "../../../lib/admin/client";
import { Revisions } from "../../../lib/admin/Revisions";
import { SettingsSection } from "../../../lib/admin/settings/Section";

const admin = getRouteApi("/admin");

export const Route = createFileRoute("/admin/settings/revisions")({
  loader: ({ context }) => getRevisions(context.site).catch(orNotFound),
  component: () => {
    const { site } = admin.useLoaderData();
    const router = useRouter();
    return (
      <SettingsSection title="Revisions" subtitle="Every save is kept. Go back to any of them.">
        <Revisions site={site} list={Route.useLoaderData()} onReload={() => void router.invalidate()} />
      </SettingsSection>
    );
  },
});
