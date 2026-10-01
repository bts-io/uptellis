import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { ConfigEditor } from "../../../lib/admin/ConfigEditor";
import { viewServices } from "../../../lib/admin/monitors/model";

const admin = getRouteApi("/admin");

/** Advanced: the full config editor, as a form or as JSON, with its review and save. */
export const Route = createFileRoute("/admin/settings/advanced")({
  component: () => {
    const { site, state, view } = admin.useLoaderData();
    const router = useRouter();
    return (
      <ConfigEditor
        key={state.version}
        site={site}
        state={state}
        services={viewServices(view).map((s) => ({ id: s.id, name: s.name }))}
        onReload={() => void router.invalidate()}
      />
    );
  },
});
