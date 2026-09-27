import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { ImportExport } from "../../lib/admin/ImportExport";

const admin = getRouteApi("/admin");

export const Route = createFileRoute("/admin/files")({
  component: () => {
    const { site } = admin.useLoaderData();
    const router = useRouter();
    return <ImportExport site={site} onReload={() => void router.invalidate()} />;
  },
});
