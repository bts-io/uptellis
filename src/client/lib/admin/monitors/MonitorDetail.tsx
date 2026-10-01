/**
 * The detail drawer (wide) of one row: its state and for how long, uptime, the response time chart, recent
 * checks, incidents, where it runs and where alerts go, and the actions Send test alert, Edit,
 * Pause/Resume and Delete (with an inline confirmation). A heartbeat can get a new address here (the old one
 * stops at once). A service another source reports is read-only: only the test alert.
 */
import { useId, useState } from "react";
import type { SiteConfig } from "@/shared/config";
import { BUILTIN_RUNNER } from "@/shared/monitors";
import type { SiteView } from "@/shared/view";
import { describeFailure, issuePushUrl } from "../client";
import { Drawer } from "../Drawer";
import { EmptyState } from "../EmptyState";
import { AdminIcon } from "../icons";
import { pushCurl } from "../MonitorsEditor";
import { StatePill } from "../StatePill";
import { useToast } from "../Toast";
import { Button, Notice } from "../ui";
import type { SiteConfigApi } from "../useSiteConfig";
import {
  ago,
  durationWords,
  every,
  KIND_LABEL,
  type MonitorRow,
  millis,
  removeMonitor,
  roughly,
  runnerName,
  secondsSince,
  setEnabled,
} from "./model";
import { alertChannelsFor, CodeBox, Fact, PendingBox, sendTestAlert, UptimeTiles } from "./parts";
import { ResponseChart } from "./ResponseChart";

export interface MonitorDetailProps {
  open: boolean;
  onClose: () => void;
  row: MonitorRow | null;
  site: string;
  config: SiteConfig;
  view: SiteView | null;
  save: SiteConfigApi["save"];
  onEdit: (row: MonitorRow) => void;
}

export function MonitorDetail(props: MonitorDetailProps) {
  const { open, onClose, row } = props;
  return (
    <Drawer
      open={open && row !== null}
      onClose={onClose}
      wide
      title={row?.name ?? ""}
      description={row ? `${KIND_LABEL[row.kind]}, ${row.target}` : undefined}
    >
      {row && <DetailBody key={row.serviceId} {...props} row={row} />}
    </Drawer>
  );
}

function DetailBody({
  row,
  site,
  config,
  view,
  save,
  onEdit,
  onClose,
}: MonitorDetailProps & { row: MonitorRow }) {
  const toast = useToast();
  const id = useId();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [issued, setIssued] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const m = row.monitor;
  const heartbeat = m?.type === "push";
  const what = heartbeat ? "heartbeat" : "monitor";
  const s = row.service;
  const now = view?.now ?? new Date().toISOString();
  const open = row.incidents.find((i) => i.endedAt === null);
  const lastTs = s?.recent[0]?.ts ?? null;
  const lastAgo = lastTs ? secondsSince(lastTs, now) : null;
  const channels = alertChannelsFor(config, row.serviceId);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  const test = () =>
    run(async () => {
      const r = await sendTestAlert(site, config, row);
      toast(r.message, r.tone);
    });
  const pause = () =>
    run(async () => {
      if (!m) return;
      const verb = m.enabled ? "Paused" : "Resumed";
      const out = await save(setEnabled(m.id, !m.enabled), `${verb} ${m.name}`);
      toast(out.ok ? `${verb} ${m.name}` : out.message, out.ok ? "ok" : "error");
    });
  const remove = () =>
    run(async () => {
      if (!m) return;
      const out = await save(removeMonitor(m.id), `Deleted ${what} ${m.name}`);
      toast(out.ok ? `Deleted ${m.name}` : out.message, out.ok ? "ok" : "error");
      if (out.ok) onClose();
    });
  const rotate = () =>
    run(async () => {
      if (!m) return;
      setConfirmRotate(false);
      try {
        setIssued((await issuePushUrl(site, m.id)).url);
      } catch (err) {
        toast(describeFailure(err).message, "error");
      }
    });

  const stateLine = open
    ? `for ${roughly(open.durationS)}, since ${open.startedAt.slice(11, 16)} UTC`
    : row.state === "up" && lastAgo !== null
      ? `last checked ${ago(lastAgo)}`
      : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <p className="flex flex-wrap items-center gap-2">
          <StatePill state={row.state} size="lg" />
          {stateLine && <span className="text-sm text-muted">{stateLine}</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void test()} disabled={busy}>
            <AdminIcon name="send" size={14} />
            Send test alert
          </Button>
          {m && (
            <>
              <Button onClick={() => onEdit(row)} disabled={busy}>
                <AdminIcon name="edit" size={14} />
                Edit
              </Button>
              <Button onClick={() => void pause()} disabled={busy}>
                <AdminIcon name={m.enabled ? "pause" : "play"} size={14} />
                {m.enabled ? "Pause" : "Resume"}
              </Button>
              <Button
                tone="danger"
                aria-expanded={confirmDelete}
                aria-controls={`${id}-delete`}
                onClick={() => setConfirmDelete((v) => !v)}
                disabled={busy}
              >
                <AdminIcon name="trash" size={14} />
                Delete
              </Button>
            </>
          )}
        </div>
        {m && confirmDelete && (
          <div id={`${id}-delete`} className="border-l-2 border-down bg-raised px-3 py-3 text-sm">
            <p>
              <strong>Delete {m.name}?</strong> It stops being checked and leaves this list. This cannot be
              undone here (Settings, History can bring it back).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button tone="danger" onClick={() => void remove()} disabled={busy}>
                Delete for good
              </Button>
              <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
            </div>
          </div>
        )}
        {!m && (
          <Notice>
            This comes from {KIND_LABEL[row.kind]}. Change it there; here you can see it and test its alerts.
          </Notice>
        )}
      </div>

      {row.state === "pending" && (
        <PendingBox
          title={
            heartbeat ? "Pending, waiting for the first heartbeat" : "Pending, waiting for the first check"
          }
        >
          {heartbeat
            ? "This turns green as soon as the first ping arrives."
            : "The first check runs within a minute. You can close this; the list updates by itself."}
        </PendingBox>
      )}

      <section aria-labelledby={`${id}-up`}>
        <h3 id={`${id}-up`} className="mb-3 font-semibold text-ink">
          Uptime
        </h3>
        <UptimeTiles
          row={row}
          extra={
            heartbeat
              ? { label: "Last ping", value: ago(lastAgo) }
              : {
                  label: "Average response",
                  value: s?.avgLatencyMs != null ? millis(s.avgLatencyMs) : "No data",
                }
          }
        />
      </section>

      {!heartbeat && s && (
        <section aria-labelledby={`${id}-rt`}>
          <h3 id={`${id}-rt`} className="mb-3 font-semibold text-ink">
            Response time
          </h3>
          <ResponseChart recent={s.recent} />
        </section>
      )}

      <section aria-labelledby={`${id}-inc`}>
        <h3 id={`${id}-inc`} className="mb-3 font-semibold text-ink">
          Incidents
        </h3>
        {row.incidents.length ? (
          <ul className="flex flex-col gap-2">
            {row.incidents.map((i) => (
              <li key={i.id} className="flex flex-wrap items-start gap-2 border border-line p-3 text-sm">
                <StatePill state={i.endedAt ? "up" : "down"} />
                <span className="min-w-0">
                  <strong className="block">{i.title}</strong>
                  <span className="text-muted">
                    {i.endedAt
                      ? `Resolved after ${roughly(i.durationS)}, ${i.startedAt.slice(0, 10)} at ${i.startedAt.slice(11, 16)} UTC`
                      : `Ongoing, started ${i.startedAt.slice(11, 16)} UTC, ${roughly(i.durationS)} so far`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No recent incidents.</p>
        )}
      </section>

      <section aria-labelledby={`${id}-rc`}>
        <h3 id={`${id}-rc`} className="mb-3 font-semibold text-ink">
          {heartbeat ? "Recent pings" : "Recent checks"}
        </h3>
        {s?.recent.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Time (UTC)
                  </th>
                  <th scope="col" className="py-1 pr-3 font-normal">
                    Result
                  </th>
                  {!heartbeat && (
                    <th scope="col" className="py-1 pr-3 text-right font-normal">
                      Response
                    </th>
                  )}
                  <th scope="col" className="py-1 font-normal">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {s.recent.slice(0, 12).map((r) => (
                  <tr key={r.ts} className="border-t border-line">
                    <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">
                      {r.ts.slice(5, 10)} {r.ts.slice(11, 19)}
                    </td>
                    <td className="py-1.5 pr-3">
                      <StatePill state={r.status} />
                    </td>
                    {!heartbeat && (
                      <td className="py-1.5 pr-3 text-right tabular-nums">{millis(r.latencyMs)}</td>
                    )}
                    <td className="py-1.5 break-words text-muted">{r.message ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={heartbeat ? "No pings yet" : "No checks yet"}
            text={
              heartbeat
                ? "Each ping your job sends shows up here."
                : "Each check shows up here as soon as it runs."
            }
            action={
              <Button onClick={() => void test()} disabled={busy}>
                <AdminIcon name="send" size={14} />
                Send test alert
              </Button>
            }
          />
        )}
      </section>

      <section aria-labelledby={`${id}-set`}>
        <h3 id={`${id}-set`} className="mb-3 font-semibold text-ink">
          Settings
        </h3>
        <ul className="flex flex-col gap-2">
          {m?.type === "push" && (
            <Fact icon="pending">
              Expected {every(m.intervalS)}, with a grace period of {durationWords(m.graceS)}
            </Fact>
          )}
          {m && m.type !== "push" && (
            <>
              <Fact icon="pending">Checked {every(m.intervalS)}</Fact>
              {m.runners.map((r) => (
                <Fact key={r} icon={r === BUILTIN_RUNNER ? "cloud" : "server"}>
                  Runs on {runnerName(r, config.agents)}
                </Fact>
              ))}
            </>
          )}
          <Fact icon="alerts">
            {channels.length
              ? `Alerts go to ${channels.map((c) => c.name).join(", ")}`
              : "No alert channel sends down alerts for this yet"}
          </Fact>
          <Fact icon="eye">
            {row.onPage.sections.length
              ? `On the status page as "${row.onPage.publicName}" in ${row.onPage.sections.join(", ")}`
              : "Not on the status page"}
          </Fact>
        </ul>
      </section>

      {m?.type === "push" && (
        <section aria-labelledby={`${id}-addr`} className="flex flex-col gap-3">
          <h3 id={`${id}-addr`} className="font-semibold text-ink">
            Heartbeat address
          </h3>
          {issued ? (
            <>
              <CodeBox label="Heartbeat address" value={issued} />
              <CodeBox label="Or add this line to the end of your script" value={pushCurl(issued)} />
              <Notice tone="warn">
                <strong>Shown once.</strong> Copy it now and update your job: the old address has stopped
                working.
              </Notice>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                The address is shown only when it is made. Lost it? Make a new one: the old one stops working
                at once.
              </p>
              <div>
                <Button
                  aria-expanded={confirmRotate}
                  aria-controls={`${id}-rotate`}
                  onClick={() => setConfirmRotate((v) => !v)}
                  disabled={busy}
                >
                  Make a new address
                </Button>
              </div>
              {confirmRotate && (
                <div id={`${id}-rotate`} className="border-l-2 border-degraded bg-raised px-3 py-3 text-sm">
                  <p>Every job that calls the current address has to be updated.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button tone="primary" onClick={() => void rotate()} disabled={busy}>
                      Make the new address
                    </Button>
                    <Button onClick={() => setConfirmRotate(false)}>Keep the current one</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
