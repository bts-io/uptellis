import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { ImportExport } from "../../../lib/admin/ImportExport";
import { SettingsSection } from "../../../lib/admin/settings/Section";

const admin = getRouteApi("/admin");

export const Route = createFileRoute("/admin/settings/import-export")({
  component: () => {
    const { site } = admin.useLoaderData();
    const router = useRouter();
    return (
      <SettingsSection title="Import and export" subtitle="Move your setup in or out as one file.">
        <ImportExport site={site} onReload={() => void router.invalidate()} />
      </SettingsSection>
    );
  },
});
