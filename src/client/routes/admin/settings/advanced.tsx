import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { AdvancedEditor } from "../../../lib/admin/settings/Advanced";

const admin = getRouteApi("/admin");

/** Advanced: the full config editor, as a form or as JSON, folded away by default. */
export const Route = createFileRoute("/admin/settings/advanced")({
  component: () => {
    const { site, state, view } = admin.useLoaderData();
    const router = useRouter();
    return <AdvancedEditor site={site} state={state} view={view} onReload={() => void router.invalidate()} />;
  },
});
