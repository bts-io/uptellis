/**
 * The site's notification delivery log (Phase 6b): the latest deliveries, newest first, from
 * `GET /api/admin/sites/:site/notifications`. It loads in the browser after the page, so the config editor
 * never waits on it or fails with it. Only short error codes are shown, never a URL, token or body.
 */
import { useCallback, useEffect, useState } from "react";
import type { Delivery } from "@/shared/schemas/admin";
import { describeFailure, getDeliveries } from "./client";
import { Button, Card, Notice, when } from "./ui";

const KIND_LABEL: Record<string, string> = { open: "opened", resolve: "resolved" };

const STATUS_CLASS: Record<Delivery["status"], string> = {
  sent: "text-up",
  failed: "text-down",
  pending: "text-muted",
};

/** The status cell: `sent`, `pending`, or `failed` with whether it will be retried. */
export function statusText(d: Delivery): string {
  if (d.status !== "failed") return d.status;
  return d.retryable ? "failed, retrying" : "failed";
}

export function DeliveryTable({
  deliveries,
  channelNames,
}: {
  deliveries: Delivery[];
  channelNames: Map<string, string>;
}) {
  if (!deliveries.length) return <p className="text-sm text-muted">No notifications sent yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Recent deliveries, newest first</caption>
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-1 pr-3 font-normal">When</th>
            <th className="py-1 pr-3 font-normal">Channel</th>
            <th className="py-1 pr-3 font-normal">Incident</th>
            <th className="py-1 pr-3 font-normal">Kind</th>
            <th className="py-1 pr-3 font-normal">Status</th>
            <th className="py-1 pr-3 font-normal">Attempts</th>
            <th className="py-1 font-normal">Error</th>
          </tr>
        </thead>
        <tbody className="text-xs">
          {deliveries.map((d) => (
            <tr key={`${d.incidentId}:${d.kind}:${d.channel}`} className="border-t border-hair align-top">
              <td className="py-1.5 pr-3 whitespace-nowrap">
                {when(d.sentAt ?? d.lastAttemptAt ?? d.createdAt)}
              </td>
              <td className="py-1.5 pr-3">
                {channelNames.get(d.channel) ?? d.channel}{" "}
                <span className="font-mono text-faint">{d.channel}</span>
              </td>
              <td className="py-1.5 pr-3 font-mono break-all">{d.incidentId}</td>
              <td className="py-1.5 pr-3">{KIND_LABEL[d.kind] ?? d.kind}</td>
              <td className={`py-1.5 pr-3 ${STATUS_CLASS[d.status]}`}>{statusText(d)}</td>
              <td className="py-1.5 pr-3">{d.attempts}</td>
              <td className="py-1.5 font-mono">{d.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DeliveryLog({ site, channelNames }: { site: string; channelNames: Map<string, string> }) {
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setDeliveries((await getDeliveries(site)).deliveries);
    } catch (err) {
      setError(describeFailure(err).message);
    } finally {
      setBusy(false);
    }
  }, [site]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Card
      title="Delivery log"
      aside={
        <Button onClick={() => void load()} disabled={busy}>
          Refresh
        </Button>
      }
    >
      <p className="mb-3 text-xs text-muted">
        The latest 50 notifications, newest first: one row per incident change and channel. Failed ones that
        can be retried are, for up to an hour.
      </p>
      {error && (
        <Notice tone="error" className="mb-3">
          Could not load the delivery log: {error}
        </Notice>
      )}
      {deliveries === null ? (
        !error && <p className="text-sm text-muted">Loading...</p>
      ) : (
        <DeliveryTable deliveries={deliveries} channelNames={channelNames} />
      )}
    </Card>
  );
}
