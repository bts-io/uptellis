import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { SiteConfig } from "@/shared/config";
import { channelsOf } from "@/shared/notify";
import { ChannelsField } from "../../lib/admin/ChannelsEditor";
import { knownServices, validateConfig } from "../../lib/admin/ConfigEditor";
import { DeliveryLog } from "../../lib/admin/DeliveryLog";
import { AlertsField } from "../../lib/admin/MonitorsEditor";
import { viewServices } from "../../lib/admin/monitors/model";
import { PageHeader } from "../../lib/admin/PageHeader";
import { useToast } from "../../lib/admin/Toast";
import { Button, Card, issuesAt, Notice } from "../../lib/admin/ui";
import { useSiteConfig } from "../../lib/admin/useSiteConfig";

const admin = getRouteApi("/admin");

/**
 * Alerts (placeholder until its redesign): the full editor's alert channels and Discord switch over one
 * draft, saved through the save path, then the delivery log.
 */
export const Route = createFileRoute("/admin/alerts")({
  component: AlertsPage,
});

function AlertsPage() {
  const { site, state, view } = admin.useLoaderData();
  const router = useRouter();
  const toast = useToast();
  const cfg = useSiteConfig({ site, state, onReload: () => void router.invalidate() });
  const [notify, setNotify] = useState<SiteConfig["notify"]>(() => cfg.config.notify);
  const [error, setError] = useState<string | null>(null);
  const next = { ...cfg.config, notify };
  const issues = validateConfig(next);
  const at = (path: string) => issuesAt(issues, path);
  const known = knownServices(
    next,
    viewServices(view).map((s) => ({ id: s.id, name: s.name })),
  );
  const changed = JSON.stringify(notify) !== JSON.stringify(cfg.config.notify);
  const channelNames = new Map(channelsOf(cfg.config.notify).map((c) => [c.id, c.name]));

  const save = async () => {
    setError(null);
    const out = await cfg.save((c) => ({ ...c, notify }), "Updated alert channels");
    // On a conflict the page reloads underneath and the draft stays, so saving again applies it to the latest.
    if (out.ok) toast("Saved alert channels");
    else setError(out.message);
  };

  return (
    <>
      <PageHeader title="Alerts" subtitle="Where we tell you when something goes down or comes back." />
      <div className="flex flex-col gap-6">
        <Card title="Alert channels">
          <div className="flex flex-col gap-6">
            <AlertsField notify={notify} onChange={setNotify} />
            <ChannelsField
              site={site}
              notify={notify}
              saved={cfg.config.notify}
              services={[...known]}
              at={at}
              onChange={setNotify}
            />
            {error && <Notice tone="error">{error}</Notice>}
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <Button
                tone="primary"
                onClick={() => void save()}
                disabled={!changed || issues.length > 0 || cfg.saving}
              >
                Save alert channels
              </Button>
              {issues.length > 0 && (
                <span className="text-xs text-down">
                  {issues.length === 1 ? "1 field needs attention" : `${issues.length} fields need attention`}
                </span>
              )}
            </div>
          </div>
        </Card>
        <DeliveryLog key={`log-${cfg.version}`} site={site} channelNames={channelNames} />
      </div>
    </>
  );
}
