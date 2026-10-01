/**
 * Small pieces the dashboard and its drawers share: the one-time code box with Copy, the pending box, the
 * 30-day strip, the uptime tiles, and sending a test alert about one service to every channel that would
 * alert for it.
 */
import { type ReactNode, useState } from "react";
import type { SiteConfig } from "@/shared/config";
import { channelsOf, channelWants } from "@/shared/notify";
import type { DisplayState } from "@/shared/view";
import { cx } from "../../../kit/cx";
import { testChannel } from "../client";
import { AdminIcon, type AdminIconName } from "../icons";
import { Button } from "../ui";
import { type MonitorRow, percent } from "./model";

/** A value shown once (a heartbeat address, its curl line) with a Copy button and a polite result. */
export function CodeBox({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div>
      <p className="text-sm text-muted">{label}</p>
      <div className="mt-1 flex items-start gap-2 border border-line bg-base p-2">
        <code className="min-w-0 flex-1 font-mono text-xs break-all text-ink select-all">{value}</code>
        <Button onClick={() => void copy()} aria-label={`Copy ${label.toLowerCase()}`}>
          <AdminIcon name={copied ? "check" : "copy"} size={14} />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p role="status" className="mt-1 text-xs text-muted">
        {copied === false ? "Copy did not work here: select the text and copy it by hand." : ""}
      </p>
    </div>
  );
}

/** "Pending, waiting for the first check": what a new monitor or heartbeat shows until it has data. */
export function PendingBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-3 border border-dashed border-degraded bg-raised p-4">
      <AdminIcon name="pending" size={24} className="mt-0.5 text-degraded" />
      <div>
        <h3 className="font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-sm text-muted">{children}</p>
      </div>
    </div>
  );
}

const DAY: Record<DisplayState | "none", string> = {
  up: "bg-up opacity-80",
  degraded: "bg-degraded",
  pending: "bg-degraded",
  down: "bg-down",
  maintenance: "bg-maint opacity-80",
  paused: "bg-faint opacity-40",
  unknown: "bg-faint opacity-40",
  stale: "bg-faint opacity-40",
  none: "bg-faint opacity-25",
};

/** The last 30 days as small bars, with one sentence for screen readers. */
export function DayStrip({ row }: { row: MonitorRow }) {
  if (row.days.length === 0) return <span className="text-xs text-muted">No history yet</span>;
  const bad = row.days.filter((d) => d === "down").length;
  const label =
    row.state === "paused"
      ? "Paused for part of the last 30 days"
      : bad
        ? `${bad} ${bad === 1 ? "day" : "days"} with downtime in the last 30`
        : "No downtime in the last 30 days";
  return (
    <div role="img" aria-label={label} className="flex h-6 items-end gap-px">
      {row.days.map((d, i) => (
        <span key={i} className={cx("h-full w-1 rounded-[1px]", DAY[d])} />
      ))}
    </div>
  );
}

/** Uptime over 24 hours, 7 and 30 days, plus one more tile (average response or last ping). */
export function UptimeTiles({ row, extra }: { row: MonitorRow; extra?: { label: string; value: string } }) {
  const tiles = [
    ["24 hours", percent(row.uptime24h)],
    ["7 days", percent(row.uptime7d)],
    ["30 days", percent(row.uptime30d)],
    ...(extra ? [[extra.label, extra.value]] : []),
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map(([k, v]) => (
        <div key={k} className="border border-line bg-base px-3 py-2">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className={cx("text-lg font-semibold tabular-nums", v === "No data" && "text-sm text-muted")}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A fact with an icon, for the "key facts" lists. */
export function Fact({ icon, children }: { icon: AdminIconName; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm text-ink">
      <AdminIcon name={icon} size={16} className="mt-0.5 text-muted" />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** The channels that would send a down alert about this service. */
export const alertChannelsFor = (config: SiteConfig, serviceId: string) =>
  channelsOf(config.notify).filter((c) => channelWants(c, "down", serviceId));

/**
 * Sends a TEST down alert about `row` to every channel that would alert for it, and says what happened
 * in one sentence for a toast.
 */
export async function sendTestAlert(
  site: string,
  config: SiteConfig,
  row: MonitorRow,
): Promise<{ message: string; tone: "ok" | "error" }> {
  const channels = alertChannelsFor(config, row.serviceId);
  if (channels.length === 0)
    return {
      message: `No alert channel sends down alerts for ${row.name} yet. Add one under Alerts.`,
      tone: "error",
    };
  const results = await Promise.all(channels.map((c) => testChannel(site, c.id, "down", row.serviceId)));
  const failed = channels.filter((_, i) => !results[i]!.sent).map((c) => c.name);
  if (failed.length === 0)
    return {
      message: `Test alert for ${row.name} sent to ${channels.length === 1 ? channels[0]!.name : `${channels.length} channels`}.`,
      tone: "ok",
    };
  return {
    message: `The test alert did not go through on ${failed.join(", ")}. Check ${failed.length === 1 ? "that channel" : "those channels"} under Alerts.`,
    tone: "error",
  };
}
