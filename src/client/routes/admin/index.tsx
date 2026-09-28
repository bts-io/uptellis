import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { channelsOf } from "@/shared/notify";
import type { SiteView } from "@/shared/view";
import { ConfigEditor } from "../../lib/admin/ConfigEditor";
import { DeliveryLog } from "../../lib/admin/DeliveryLog";
import { api } from "../../lib/api";

const admin = getRouteApi("/admin");

/**
 * The config editor, then the notification delivery log; the live view supplies the services a section can
 * hold.
 */
export const Route = createFileRoute("/admin/")({
  loader: async ({ context }) => {
    const view = await api<SiteView>(`/api/sites/${encodeURIComponent(context.site)}/view`).catch(() => null);
    const services = view ? [...view.sections.flatMap((s) => s.services), ...view.unsectioned] : [];
    return { services: services.map((s) => ({ id: s.id, name: s.name })) };
  },
  component: ConfigPage,
});

function ConfigPage() {
  const { site, state } = admin.useLoaderData();
  const { services } = Route.useLoaderData();
  const router = useRouter();
  const channelNames = new Map(channelsOf(state.config.notify).map((c) => [c.id, c.name]));
  return (
    <div className="flex flex-col gap-6">
      <ConfigEditor
        key={state.version}
        site={site}
        state={state}
        services={services}
        onReload={() => void router.invalidate()}
      />
      <DeliveryLog key={`log-${state.version}`} site={site} channelNames={channelNames} />
    </div>
  );
}
