/**
 * The Monitors dashboard (`/admin`): four numbers, a search and an All / Heartbeats switch, and one table of
 * monitors, heartbeats and other sources' services (down first, paused last). A row expands inline with its
 * key facts and actions; everything else happens in drawers (new, edit, details, heartbeat). On a phone the
 * table becomes stacked cards. Every change goes through `useSiteConfig`.
 */
import { useEffect, useId, useState } from "react";
import type { PushMonitor, RunnerMonitorConfig } from "@/shared/monitors";
import { channelsOf } from "@/shared/notify";
import type { ConfigState } from "@/shared/schemas/admin";
import type { SiteView } from "@/shared/view";
import { cx } from "../../../kit/cx";
import { testChannel } from "../client";
import { EmptyState } from "../EmptyState";
import { AdminIcon } from "../icons";
import { PageHeader } from "../PageHeader";
import { StatePill } from "../StatePill";
import { useToast } from "../Toast";
import { Button, inputClass } from "../ui";
import { useSiteConfig } from "../useSiteConfig";
import { Checklist } from "./Checklist";
import { type ChecklistFacts, rememberTestAlert, welcomeSkipped } from "./firstRun";
import { HeartbeatForm } from "./HeartbeatForm";
import { MonitorDetail } from "./MonitorDetail";
import { MonitorForm } from "./MonitorForm";
import {
  ago,
  buildRows,
  every,
  KIND_ICON,
  KIND_LABEL,
  type MonitorRow,
  millis,
  percent,
  roughly,
  runnerShort,
  secondsSince,
  setEnabled,
  sortRows,
  statsOf,
} from "./model";
import { DayStrip, Fact, sendTestAlert, UptimeTiles } from "./parts";

type Open =
  | { kind: "new-monitor" }
  | { kind: "edit-monitor"; serviceId: string }
  | { kind: "new-heartbeat" }
  | { kind: "edit-heartbeat"; serviceId: string }
  | { kind: "detail"; serviceId: string }
  | null;

export interface MonitorsDashboardProps {
  site: string;
  state: ConfigState;
  /** The site view (`GET /api/sites/:site/view`); null when it could not be read. */
  view: SiteView | null;
  onReload: () => void;
  /** What the Getting started card needs beyond the config (the delivery log, how many users). */
  facts?: Omit<ChecklistFacts, "testSent">;
  /** Follows a link inside the admin (the Getting started items). */
  onNavigate?: (to: string) => void;
  /** A service whose detail drawer is open on arrival (the monitor the first-run screen just added). */
  initialDetail?: string;
  /** Called when nothing is watched and the first-run screen was not skipped in this browser. */
  onWelcome?: () => void;
}

export function MonitorsDashboard({
  site,
  state,
  view,
  onReload,
  facts = { deliveries: null, users: null },
  onNavigate,
  initialDetail,
  onWelcome,
}: MonitorsDashboardProps) {
  const cfg = useSiteConfig({ site, state, onReload });
  const toast = useToast();
  const [filter, setFilter] = useState<"all" | "heartbeats">("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<Open>(initialDetail ? { kind: "detail", serviceId: initialDetail } : null);
  const [testSent, setTestSent] = useState(false);
  const [testing, setTesting] = useState(false);
  const searchId = useId();

  const all = buildRows(cfg.config, view);
  const empty = all.length === 0;
  useEffect(() => {
    if (empty && onWelcome && !welcomeSkipped(site)) onWelcome();
  }, [empty, onWelcome, site]);
  const heartbeats = all.filter((r) => r.kind === "push");
  const listed = sortRows(filter === "heartbeats" ? heartbeats : all);
  const q = query.trim().toLowerCase();
  const shown = q
    ? listed.filter((r) => r.name.toLowerCase().includes(q) || r.target.toLowerCase().includes(q))
    : listed;
  const stats = statsOf(listed);
  const find = (id: string | undefined) => all.find((r) => r.serviceId === id) ?? null;
  const current = open && "serviceId" in open ? find(open.serviceId) : null;
  const close = () => setOpen(null);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const sendFirstTest = async () => {
    const enabled = channelsOf(cfg.config.notify).filter((c) => c.enabled);
    const channels = cfg.config.notify.channels.length
      ? enabled.filter((c) => cfg.config.notify.channels.includes(c))
      : enabled;
    if (channels.length === 0) {
      toast("Add an alert channel under Alerts first, then send a test.", "error");
      return;
    }
    setTesting(true);
    const service = all.find((r) => r.monitor)?.serviceId;
    const results = await Promise.all(channels.map((c) => testChannel(site, c.id, "down", service)));
    setTesting(false);
    if (results.some((r) => r.sent)) rememberTestAlert(site);
    const failed = channels.filter((_, i) => !results[i]!.sent).map((c) => c.name);
    if (failed.length === 0) {
      setTestSent(true);
      toast(
        `Test alert sent to ${channels.length === 1 ? channels[0]!.name : `${channels.length} channels`}.`,
      );
    } else
      toast(`The test alert did not go through on ${failed.join(", ")}. Check it under Alerts.`, "error");
  };
  const edit = (row: MonitorRow) =>
    setOpen({ kind: row.kind === "push" ? "edit-heartbeat" : "edit-monitor", serviceId: row.serviceId });

  const header = (
    <PageHeader
      title={filter === "heartbeats" ? "Heartbeats" : "Monitors"}
      subtitle={
        filter === "heartbeats"
          ? "Jobs that check in with us. We alert you when one goes quiet."
          : `Everything we watch for ${cfg.config.name}, checked around the clock.`
      }
      actions={
        <>
          <Button onClick={() => setOpen({ kind: "new-heartbeat" })} className="py-2">
            <AdminIcon name="heartbeat" />
            New heartbeat
          </Button>
          <Button tone="primary" onClick={() => setOpen({ kind: "new-monitor" })} className="py-2">
            <AdminIcon name="plus" />
            New monitor
          </Button>
        </>
      }
    />
  );

  const drawers = (
    <>
      <MonitorForm
        open={open?.kind === "new-monitor" || open?.kind === "edit-monitor"}
        onClose={close}
        config={cfg.config}
        save={cfg.save}
        editing={
          open?.kind === "edit-monitor" ? ((current?.monitor as RunnerMonitorConfig | null) ?? null) : null
        }
        onCreated={(serviceId) => setOpen({ kind: "detail", serviceId })}
        onHeartbeat={() => setOpen({ kind: "new-heartbeat" })}
      />
      <HeartbeatForm
        open={open?.kind === "new-heartbeat" || open?.kind === "edit-heartbeat"}
        onClose={close}
        site={site}
        config={cfg.config}
        save={cfg.save}
        editing={open?.kind === "edit-heartbeat" ? ((current?.monitor as PushMonitor | null) ?? null) : null}
      />
      <MonitorDetail
        open={open?.kind === "detail"}
        onClose={close}
        row={open?.kind === "detail" ? current : null}
        site={site}
        config={cfg.config}
        view={view}
        save={cfg.save}
        onEdit={edit}
      />
    </>
  );

  if (empty) {
    return (
      <>
        {header}
        <EmptyState
          title="Nothing is being watched yet"
          text="Add a website or server and we check it every minute and tell you the moment it goes down."
          action={
            <Button tone="primary" onClick={() => setOpen({ kind: "new-monitor" })} className="py-2">
              <AdminIcon name="plus" />
              New monitor
            </Button>
          }
        />
        {drawers}
      </>
    );
  }

  const checklist =
    filter === "all" ? (
      <Checklist
        site={site}
        config={cfg.config}
        facts={{ ...facts, testSent }}
        onNavigate={onNavigate}
        onSendTest={() => void sendFirstTest()}
        onNewHeartbeat={() => setOpen({ kind: "new-heartbeat" })}
        busy={testing}
      />
    ) : null;

  if (filter === "heartbeats" && heartbeats.length === 0) {
    return (
      <>
        {header}
        <div className="mb-3 flex justify-end">
          <FilterSwitch filter={filter} setFilter={setFilter} all={all.length} heartbeats={0} />
        </div>
        <EmptyState
          title="No heartbeats yet"
          text="Add one for a cron job or a backup: it pings us when it runs, and we alert you when it stops."
          action={
            <Button tone="primary" onClick={() => setOpen({ kind: "new-heartbeat" })} className="py-2">
              <AdminIcon name="heartbeat" />
              New heartbeat
            </Button>
          }
        />
        {drawers}
      </>
    );
  }

  return (
    <>
      {header}
      {checklist}
      <section aria-label="Overview" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Up"
          icon="up"
          tone="text-up"
          value={String(stats.up)}
          sub={`of ${stats.total} watched`}
        />
        <Stat
          label="Down"
          icon="down"
          tone="text-down"
          value={String(stats.down)}
          sub={stats.down ? stats.downNames.join(", ") : "Nothing is down"}
          alarm={stats.down > 0}
        />
        <Stat label="Paused" icon="paused" value={String(stats.paused)} sub="Not being checked" />
        <Stat
          label="Uptime, last 30 days"
          icon="pending"
          value={percent(stats.uptime30d)}
          sub="Average of everything running"
        />
      </section>

      <section aria-label={filter === "heartbeats" ? "All heartbeats" : "All monitors and heartbeats"}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-sm">
            <AdminIcon
              name="search"
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted"
            />
            <label htmlFor={searchId} className="sr-only">
              Search by name or address
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              placeholder="Search by name or address"
              autoComplete="off"
              onChange={(e) => setQuery(e.target.value)}
              className={cx(inputClass, "py-2 pl-9")}
            />
          </div>
          <FilterSwitch
            filter={filter}
            setFilter={setFilter}
            all={all.length}
            heartbeats={heartbeats.length}
          />
        </div>

        <table className="w-full border-collapse border border-line bg-panel text-sm max-sm:block max-sm:border-0 max-sm:bg-transparent">
          <caption className="sr-only">
            {shown.length === 1 ? "1 item" : `${shown.length} items`}. Select a name to show its details.
          </caption>
          <thead className="bg-raised text-left text-xs text-muted max-sm:hidden">
            <tr>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Status
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold">
                Name
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold max-lg:hidden">
                Type
              </th>
              <th scope="col" className="px-3 py-2.5 font-semibold max-md:hidden">
                Last 30 days
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                Uptime
              </th>
              <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                Response
              </th>
            </tr>
          </thead>
          <tbody className="max-sm:flex max-sm:flex-col max-sm:gap-3">
            {shown.map((row) => (
              <Row
                key={row.serviceId}
                row={row}
                site={site}
                view={view}
                expanded={expanded.has(row.serviceId)}
                onToggle={() => toggle(row.serviceId)}
                onDetails={() => setOpen({ kind: "detail", serviceId: row.serviceId })}
                onEdit={() => edit(row)}
                config={cfg.config}
                save={cfg.save}
              />
            ))}
            {shown.length === 0 && (
              <tr className="max-sm:block">
                <td colSpan={6} className="px-3 py-6 text-center text-muted max-sm:block">
                  Nothing matches that search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      {drawers}
    </>
  );
}

function FilterSwitch({
  filter,
  setFilter,
  all,
  heartbeats,
}: {
  filter: "all" | "heartbeats";
  setFilter: (f: "all" | "heartbeats") => void;
  all: number;
  heartbeats: number;
}) {
  return (
    <div role="group" aria-label="Show" className="inline-flex border border-line p-0.5">
      {(
        [
          ["all", "All", all],
          ["heartbeats", "Heartbeats", heartbeats],
        ] as const
      ).map(([key, label, n]) => (
        <button
          key={key}
          type="button"
          aria-pressed={filter === key}
          onClick={() => setFilter(key)}
          className={cx(
            "px-3 py-1.5 text-sm",
            filter === key ? "bg-raised font-semibold text-ink" : "text-muted hover:text-ink",
          )}
        >
          {label} <span className="text-xs text-muted">{n}</span>
        </button>
      ))}
    </div>
  );
}

function Stat({
  label,
  icon,
  tone,
  value,
  sub,
  alarm,
}: {
  label: string;
  icon: "up" | "down" | "paused" | "pending";
  tone?: string;
  value: string;
  sub: string;
  alarm?: boolean;
}) {
  return (
    <div className={cx("border bg-panel px-4 py-3", alarm ? "border-down" : "border-line")}>
      <p className={cx("flex items-center gap-1.5 text-sm font-semibold", tone ?? "text-muted")}>
        <AdminIcon name={icon} />
        {label}
      </p>
      <p className={cx("mt-1 text-3xl font-bold tabular-nums", alarm ? "text-down" : "text-ink")}>{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted" title={sub}>
        {sub}
      </p>
    </div>
  );
}

function responseText(row: MonitorRow, now: string): string {
  const last = row.service?.recent[0]?.ts;
  if (row.kind === "push") {
    if (row.state === "paused") return "Paused";
    return last ? `Pinged ${ago(secondsSince(last, now))}` : "No ping yet";
  }
  if (row.state === "paused" || row.state === "pending") return "Waiting";
  return row.service ? millis(row.service.latencyMs) : "Waiting";
}

function Row({
  row,
  site,
  view,
  expanded,
  onToggle,
  onDetails,
  onEdit,
  config,
  save,
}: {
  row: MonitorRow;
  site: string;
  view: SiteView | null;
  expanded: boolean;
  onToggle: () => void;
  onDetails: () => void;
  onEdit: () => void;
  config: ReturnType<typeof useSiteConfig>["config"];
  save: ReturnType<typeof useSiteConfig>["save"];
}) {
  const toast = useToast();
  const detailId = useId();
  const [busy, setBusy] = useState(false);
  const now = view?.now ?? new Date().toISOString();
  const m = row.monitor;
  const last = row.service?.recent[0];
  const openIncident = row.incidents.find((i) => i.endedAt === null);

  const pause = async () => {
    if (!m) return;
    setBusy(true);
    const verb = m.enabled ? "Paused" : "Resumed";
    const out = await save(setEnabled(m.id, !m.enabled), `${verb} ${m.name}`);
    setBusy(false);
    toast(out.ok ? `${verb} ${m.name}` : out.message, out.ok ? "ok" : "error");
  };
  const test = async () => {
    setBusy(true);
    const r = await sendTestAlert(site, config, row);
    setBusy(false);
    toast(r.message, r.tone);
  };

  return (
    <>
      <tr
        data-row={row.kind}
        className={cx(
          "border-t border-line align-middle hover:bg-raised max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-x-3 max-sm:gap-y-2 max-sm:border max-sm:bg-panel max-sm:p-3",
          expanded && "bg-raised",
          row.state === "down" && "max-sm:border-down",
        )}
      >
        <td className="px-3 py-3 max-sm:order-2 max-sm:p-0">
          <StatePill state={row.state} />
        </td>
        <td className="px-3 py-3 max-sm:order-1 max-sm:p-0">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailId}
            onClick={onToggle}
            className="flex w-full min-w-0 items-center gap-2.5 text-left"
          >
            <AdminIcon name={KIND_ICON[row.kind]} size={18} className="text-muted" />
            <span className="min-w-0">
              <span className="block truncate font-semibold text-ink">{row.name}</span>
              <span className="block truncate text-xs text-muted">{row.target}</span>
            </span>
            <AdminIcon
              name="chevron"
              className={cx("ml-auto text-muted sm:hidden", expanded && "rotate-180")}
            />
          </button>
        </td>
        <td className="px-3 py-3 max-lg:hidden">
          <span className="text-xs text-muted">{KIND_LABEL[row.kind]}</span>
        </td>
        <td className="px-3 py-3 max-md:hidden">
          <DayStrip row={row} />
        </td>
        <td className="px-3 py-3 text-right tabular-nums max-sm:order-3 max-sm:p-0 max-sm:text-left">
          <span className="sr-only sm:hidden">Uptime </span>
          <strong>{percent(row.uptime30d)}</strong>
        </td>
        <td className="px-3 py-3 text-right text-muted tabular-nums max-sm:order-4 max-sm:p-0">
          {responseText(row, now)}
        </td>
      </tr>
      <tr id={detailId} hidden={!expanded} className="bg-raised max-sm:block">
        <td
          colSpan={6}
          className="px-3 pt-1 pb-4 max-sm:block max-sm:border max-sm:border-t-0 max-sm:border-line"
        >
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <ul className="flex flex-col gap-1.5">
              {m?.type === "push" && (
                <>
                  <Fact icon="pending">{row.target}</Fact>
                  <Fact icon="heartbeat">
                    {last ? `Last ping ${ago(secondsSince(last.ts, now))}` : "No ping yet"}
                  </Fact>
                </>
              )}
              {m && m.type !== "push" && (
                <>
                  <Fact icon="pending">
                    Checked {every(m.intervalS)} from{" "}
                    {m.runners.map((r) => runnerShort(r, config.agents)).join(" and ")}
                  </Fact>
                  {last && (
                    <Fact icon={last.status === "up" ? "up" : "down"}>
                      Last check {ago(secondsSince(last.ts, now))}
                      {last.message ? `: ${last.message}` : ""}
                    </Fact>
                  )}
                </>
              )}
              {!m && <Fact icon="source">Reported by {KIND_LABEL[row.kind]}. Change it there.</Fact>}
              {openIncident && (
                <Fact icon="degraded">
                  Down since {openIncident.startedAt.slice(11, 16)} UTC ({roughly(openIncident.durationS)})
                </Fact>
              )}
            </ul>
            <div className="md:w-96">
              <UptimeTiles row={row} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button tone="primary" onClick={onDetails}>
              Open details
            </Button>
            {m && (
              <>
                <Button onClick={onEdit} disabled={busy}>
                  <AdminIcon name="edit" size={14} />
                  Edit
                </Button>
                <Button onClick={() => void pause()} disabled={busy}>
                  <AdminIcon name={m.enabled ? "pause" : "play"} size={14} />
                  {m.enabled ? "Pause" : "Resume"}
                </Button>
              </>
            )}
            <Button onClick={() => void test()} disabled={busy}>
              <AdminIcon name="send" size={14} />
              Send test alert
            </Button>
          </div>
        </td>
      </tr>
    </>
  );
}
