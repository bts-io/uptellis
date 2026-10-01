/**
 * The New monitor and Edit monitor drawers: the address first, the check type inferred from it (a switch
 * the user can change), a name taken from the host until edited, "every minute" and "all alert channels"
 * by default, and the rest folded under "More options" with a one-line summary of its values. Saving goes
 * through the save path (`useSiteConfig`), so the monitor lands in the config exactly as the full editor
 * would write it.
 */
import { type FormEvent, useId, useState } from "react";
import type { SiteConfig } from "@/shared/config";
import { BUILTIN_RUNNER, type RunnerMonitorConfig } from "@/shared/monitors";
import { channelsOf } from "@/shared/notify";
import type { ConfigIssue } from "@/shared/schemas/admin";
import { cx } from "../../../kit/cx";
import { Drawer } from "../Drawer";
import { AdminIcon } from "../icons";
import { useToast } from "../Toast";
import { Button, inputClass, Notice } from "../ui";
import type { SiteConfigApi } from "../useSiteConfig";
import { applyChange } from "../useSiteConfig";
import {
  draftOf,
  every,
  inferType,
  KIND_LABEL,
  type MonitorDraft,
  monitorFromDraft,
  nameFromTarget,
  type RunnerType,
  runnerName,
  runnerShort,
  upsertMonitor,
} from "./model";

const TYPES: RunnerType[] = ["http", "tcp", "ping", "tls"];
const TYPE_HINT: Record<RunnerType, string> = {
  http: "We load the page and expect a good status code.",
  tcp: "We open a connection to the port.",
  ping: "We check the host answers.",
  tls: "We watch the certificate and warn before it expires.",
};
const INTERVALS = [60, 120, 300, 600, 1800, 3600];
const TIMEOUTS = [5, 10, 20, 30];
const RETRIES = [0, 1, 2, 3];
const retryWords = (n: number) =>
  n === 0
    ? "Alert on the first failure"
    : n === 1
      ? "Retry once"
      : n === 2
        ? "Retry twice"
        : `Retry ${n} times`;
const withCurrent = (list: number[], v: number) =>
  list.includes(v) ? list : [...list, v].sort((a, b) => a - b);

/** A schema issue in plain words for the field it belongs to. */
function plain(issue: ConfigIssue, field: string): string {
  if (/public hostname/.test(issue.message))
    return "This address only works inside a private network. Choose an agent under More options to check it from there.";
  if (field === "url") return "Enter a web address, like https://example.com/.";
  if (field === "host") return "Enter a host name, like db.example.com.";
  if (field === "port") return "Add a port, like db.example.com:5432.";
  if (field === "name" && /too_small|>=1|at least/i.test(issue.message)) return "Give it a name.";
  return issue.message;
}

export interface MonitorFormProps {
  open: boolean;
  onClose: () => void;
  config: SiteConfig;
  save: SiteConfigApi["save"];
  /** The monitor being edited; null for a new one. */
  editing: RunnerMonitorConfig | null;
  /** After a new monitor is saved: its service id (the detail drawer opens on it). */
  onCreated: (serviceId: string) => void;
  /** "Set up a heartbeat" instead. */
  onHeartbeat: () => void;
}

export function MonitorForm(props: MonitorFormProps) {
  const { open, onClose, editing } = props;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : "New monitor"}
      initialFocus="[data-monitor-target]"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" type="submit" form="monitor-form">
            {editing ? "Save changes" : "Create monitor"}
          </Button>
        </>
      }
    >
      <MonitorFields key={editing?.id ?? "new"} {...props} />
    </Drawer>
  );
}

function MonitorFields({ config, save, editing, onCreated, onClose, onHeartbeat }: MonitorFormProps) {
  const toast = useToast();
  const id = useId();
  const [d, setD] = useState<MonitorDraft>(() => draftOf(editing));
  const [nameTouched, setNameTouched] = useState(!!editing);
  const [typeTouched, setTypeTouched] = useState(!!editing);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<MonitorDraft>) => setD((x) => ({ ...x, ...patch }));

  const monitor = monitorFromDraft(editing, d, config.monitors);
  const index = config.monitors.some((m) => m.id === monitor.id)
    ? config.monitors.findIndex((m) => m.id === monitor.id)
    : config.monitors.length;
  const checked = applyChange(config, upsertMonitor(monitor));
  const issues = checked.ok ? [] : checked.issues;
  const at = (...fields: string[]) =>
    tried
      ? issues.flatMap((i) => {
          const f = fields.find(
            (x) => i.path === `monitors.${index}.${x}` || i.path.startsWith(`monitors.${index}.${x}.`),
          );
          return f ? [plain(i, f)] : [];
        })
      : [];
  const targetIssues = at("url", "host", "port");
  const nameIssues = at("name");
  const moreIssues = at("expectStatus", "keyword", "timeoutS", "retries", "runners", "quorum", "method");
  const otherIssues = tried
    ? issues.filter((i) => !i.path.startsWith(`monitors.${index}.`)).map((i) => i.message)
    : [];

  const onTarget = (value: string) => {
    const patch: Partial<MonitorDraft> = { target: value };
    if (!typeTouched) patch.type = inferType(value);
    if (!nameTouched) patch.name = nameFromTarget(value);
    set(patch);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (!checked.ok) return;
    setBusy(true);
    const note = editing ? `Changed monitor ${monitor.name}` : `Added monitor ${monitor.name}`;
    const out = await save(upsertMonitor(monitor), note);
    setBusy(false);
    if (!out.ok) {
      setError(out.message);
      return;
    }
    toast(editing ? `Saved ${monitor.name}` : `Added monitor ${monitor.name}`);
    if (editing) onClose();
    else onCreated(`probe:${monitor.id}`);
  };

  const agents = config.agents;
  const runnerChoices = [
    BUILTIN_RUNNER,
    ...agents.map((a) => a.id),
    ...d.runners.filter((r) => r !== BUILTIN_RUNNER && !agents.some((a) => a.id === r)),
  ];
  const channels = channelsOf(config.notify).filter((c) => c.enabled);
  const summary = [
    ...(d.type === "http"
      ? [
          d.method,
          `expects ${d.expectMin} to ${d.expectMax}`,
          ...(d.keyword ? [`must contain "${d.keyword}"`] : []),
        ]
      : []),
    `gives up after ${d.timeoutS} s`,
    retryWords(d.retries).toLowerCase(),
    `runs on ${d.runners.map((r) => runnerShort(r, agents)).join(" and ") || "nothing yet"}`,
  ].join(", ");

  const f = (name: string) => `${id}-${name}`;
  return (
    <form id="monitor-form" noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
      {error && <Notice tone="error">{error}</Notice>}
      <div>
        <label htmlFor={f("target")} className="block text-sm font-medium text-ink">
          URL or host to check
        </label>
        <input
          id={f("target")}
          data-monitor-target
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://example.com"
          value={d.target}
          aria-invalid={targetIssues.length > 0 || undefined}
          aria-describedby={f("target-hint")}
          onChange={(e) => onTarget(e.target.value)}
          className={cx(inputClass, "mt-1 py-2.5 text-base", targetIssues.length > 0 && "border-down")}
        />
        <p id={f("target-hint")} className="mt-1 text-xs text-muted">
          {targetIssues.length ? (
            <span className="text-down">{targetIssues.join(" ")}</span>
          ) : (
            "A web address, a host with a port (db.example.com:5432) or just a host name."
          )}
        </p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-ink">How we check it</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {TYPES.map((t) => (
            <label
              key={t}
              className="inline-flex cursor-pointer items-center gap-1.5 border border-line px-3 py-1.5 text-sm has-checked:border-accent has-checked:bg-raised has-checked:font-semibold"
            >
              <input
                type="radio"
                name={f("type")}
                value={t}
                checked={d.type === t}
                onChange={() => {
                  setTypeTouched(true);
                  set({ type: t });
                }}
                className="accent-(--color-accent)"
              />
              {KIND_LABEL[t]}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-muted">
          {TYPE_HINT[d.type]}
          {!typeTouched && d.target.trim() ? " We picked it from the address." : ""}
        </p>
      </fieldset>

      <div>
        <label htmlFor={f("name")} className="block text-sm font-medium text-ink">
          Name
        </label>
        <input
          id={f("name")}
          type="text"
          value={d.name}
          aria-invalid={nameIssues.length > 0 || undefined}
          aria-describedby={f("name-hint")}
          onChange={(e) => {
            setNameTouched(true);
            set({ name: e.target.value });
          }}
          className={cx(inputClass, "mt-1", nameIssues.length > 0 && "border-down")}
        />
        <p id={f("name-hint")} className="mt-1 text-xs text-muted">
          {nameIssues.length ? (
            <span className="text-down">{nameIssues.join(" ")}</span>
          ) : editing ? (
            "Only you see this name. The status page can show another one."
          ) : (
            "Filled in from the address. Change it to anything you like."
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={f("interval")} className="block text-sm font-medium text-ink">
            Check
          </label>
          <select
            id={f("interval")}
            value={d.intervalS}
            onChange={(e) => set({ intervalS: Number(e.target.value) })}
            className={cx(inputClass, "mt-1")}
          >
            {withCurrent(INTERVALS, d.intervalS).map((s) => (
              <option key={s} value={s}>
                {every(s).replace(/^every/, "Every")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <p className="text-sm font-medium text-ink">Alert</p>
          <p className="mt-1 border border-line bg-base px-2 py-1.5 text-sm text-ink">
            All alert channels ({channels.length})
          </p>
          <p className="mt-1 text-xs text-muted">Choose what each channel covers under Alerts.</p>
        </div>
      </div>

      <details className="group border border-line" open={moreIssues.length > 0 || undefined}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">More options</span>
            <span className="block truncate text-xs text-muted">{summary}</span>
          </span>
          <AdminIcon name="chevron" className="text-muted group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-4 border-t border-line p-3">
          {moreIssues.length > 0 && <Notice tone="error">{moreIssues.join(" ")}</Notice>}
          {d.type === "http" && (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor={f("method")} className="block text-xs text-muted">
                    Method
                  </label>
                  <select
                    id={f("method")}
                    value={d.method}
                    onChange={(e) => set({ method: e.target.value as "GET" | "HEAD" })}
                    className={cx(inputClass, "mt-1")}
                  >
                    <option value="GET">GET</option>
                    <option value="HEAD">HEAD</option>
                  </select>
                </div>
                <div>
                  <label htmlFor={f("min")} className="block text-xs text-muted">
                    Expected status from
                  </label>
                  <input
                    id={f("min")}
                    type="number"
                    min={100}
                    max={599}
                    value={Number.isFinite(d.expectMin) ? d.expectMin : ""}
                    onChange={(e) => set({ expectMin: e.target.valueAsNumber })}
                    className={cx(inputClass, "mt-1")}
                  />
                </div>
                <div>
                  <label htmlFor={f("max")} className="block text-xs text-muted">
                    Expected status to
                  </label>
                  <input
                    id={f("max")}
                    type="number"
                    min={100}
                    max={599}
                    value={Number.isFinite(d.expectMax) ? d.expectMax : ""}
                    onChange={(e) => set({ expectMax: e.target.valueAsNumber })}
                    className={cx(inputClass, "mt-1")}
                  />
                </div>
              </div>
              <div>
                <label htmlFor={f("keyword")} className="block text-xs text-muted">
                  Page must contain (optional)
                </label>
                <input
                  id={f("keyword")}
                  type="text"
                  value={d.keyword}
                  placeholder="For example: Welcome back"
                  onChange={(e) => set({ keyword: e.target.value })}
                  className={cx(inputClass, "mt-1")}
                />
              </div>
            </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={f("timeout")} className="block text-xs text-muted">
                Give up after
              </label>
              <select
                id={f("timeout")}
                value={d.timeoutS}
                onChange={(e) => set({ timeoutS: Number(e.target.value) })}
                className={cx(inputClass, "mt-1")}
              >
                {withCurrent(TIMEOUTS, d.timeoutS).map((s) => (
                  <option key={s} value={s}>
                    {s} seconds
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={f("retries")} className="block text-xs text-muted">
                Before alerting
              </label>
              <select
                id={f("retries")}
                value={d.retries}
                onChange={(e) => set({ retries: Number(e.target.value) })}
                className={cx(inputClass, "mt-1")}
              >
                {withCurrent(RETRIES, d.retries).map((n) => (
                  <option key={n} value={n}>
                    {retryWords(n)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <fieldset>
            <legend className="text-xs text-muted">Where it runs</legend>
            <ul className="mt-1 flex flex-col gap-1">
              {runnerChoices.map((r) => (
                <li key={r}>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={d.runners.includes(r)}
                      onChange={(e) =>
                        set({
                          runners: e.target.checked
                            ? runnerChoices.filter((x) => x === r || d.runners.includes(x))
                            : d.runners.filter((x) => x !== r),
                        })
                      }
                    />
                    <span>
                      {runnerName(r, agents)}
                      <span className="block text-xs text-muted">
                        {r === BUILTIN_RUNNER
                          ? "From Uptellis itself. Best for anything public."
                          : "Runs inside your network, for private hosts."}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          {d.runners.length > 1 && (
            <div>
              <label htmlFor={f("quorum")} className="block text-xs text-muted">
                Call it down when
              </label>
              <select
                id={f("quorum")}
                value={d.quorum ?? ""}
                onChange={(e) => set({ quorum: e.target.value ? Number(e.target.value) : undefined })}
                className={cx(inputClass, "mt-1")}
              >
                <option value="">Most places agree it failed (default)</option>
                {d.runners.map((_, i) => (
                  <option key={i + 1} value={i + 1}>
                    {i === 0
                      ? "Any place that checks it fails"
                      : i + 1 === d.runners.length
                        ? "Every place agrees it failed"
                        : `At least ${i + 1} places agree it failed`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </details>

      {otherIssues.length > 0 && <Notice tone="error">{otherIssues.join(" ")}</Notice>}
      {busy && (
        <p role="status" className="text-sm text-muted">
          Saving...
        </p>
      )}

      {!editing && (
        <div className="flex items-start gap-2 border border-line bg-raised p-3 text-sm">
          <AdminIcon name="heartbeat" className="mt-0.5 text-accent" />
          <p>
            Watching a cron job or a backup instead?{" "}
            <button type="button" onClick={onHeartbeat} className="text-accent underline">
              Set up a heartbeat
            </button>
            : your job pings us and we alert you when it stops.
          </p>
        </div>
      )}
    </form>
  );
}
