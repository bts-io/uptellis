/**
 * Form parts of the config editor for Phase 6: native monitors, the agents that may run them, maintenance
 * windows and the Discord switch for down and up cards. They edit the editor's draft; saving goes through
 * the editor's review and save (a new config revision, `config.edit`), and every issue comes from the same
 * `SiteConfig` schema the server applies (`MonitorConfig`, `AgentDecl`, `MaintenanceWindow`), shown under
 * the field it belongs to.
 */
import { useMemo } from "react";
import type { SiteConfig } from "@/shared/config";
import {
  type AgentDecl,
  BUILTIN_RUNNER,
  effectiveQuorum,
  type MaintenanceWindow,
  MONITOR_TYPES,
  type MonitorConfig,
  type MonitorType,
  monitorHost,
  monitorServiceId,
  RUNNER_TYPES,
  WEEKDAYS,
} from "@/shared/monitors";
import { LEGACY_DISCORD_CHANNEL, LEGACY_DISCORD_SECRET } from "@/shared/notify";
import type { ConfigIssue } from "@/shared/schemas/admin";
import { Button, Field, IssueText, SelectField } from "./ui";

type At = (path: string) => ConfigIssue[];

const TYPE_LABEL: Record<MonitorType, string> = {
  http: "HTTP(S)",
  tcp: "TCP port",
  ping: "Ping (ICMP)",
  tls: "TLS certificate",
};

const DAY_LABEL: Record<(typeof WEEKDAYS)[number], string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** `a-1`, `a-2`, ...: the first id with this prefix not taken yet. */
const freeId = (prefix: string, taken: readonly { id: string }[]) => {
  let n = taken.length + 1;
  while (taken.some((t) => t.id === `${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
};

const num = (v: number | undefined) => (v !== undefined && Number.isFinite(v) ? v : "");

/** The monitor as `type`, keeping the common fields and the host where the types share one. */
export function withType(m: MonitorConfig, type: MonitorType): MonitorConfig {
  if (m.type === type) return m;
  const { id, name, intervalS, timeoutS, retries, runners, quorum, enabled } = m;
  const common = { id, name, intervalS, timeoutS, retries, runners, quorum, enabled };
  const host = monitorHost(m);
  switch (type) {
    case "http":
      return {
        ...common,
        type,
        url: host ? `https://${host}/` : "https://",
        method: "GET",
        expectStatus: { min: 200, max: 399 },
        keywordAbsent: false,
      };
    case "tcp":
      return { ...common, type, host, port: m.type === "tls" ? m.port : 443 };
    case "ping":
      return { ...common, type, host };
    case "tls":
      return { ...common, type, host, port: m.type === "tcp" ? m.port : 443, minDays: 7 };
  }
}

export function newMonitor(taken: readonly MonitorConfig[]): MonitorConfig {
  return {
    id: freeId("monitor", taken),
    name: "New monitor",
    type: "http",
    url: "https://",
    method: "GET",
    expectStatus: { min: 200, max: 399 },
    keywordAbsent: false,
    intervalS: 60,
    timeoutS: 10,
    retries: 1,
    runners: [BUILTIN_RUNNER],
    enabled: true,
  };
}

const move = <T,>(list: T[], i: number, by: -1 | 1): T[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

/* ------------------------------------------------------------------ */
/* Monitors                                                            */
/* ------------------------------------------------------------------ */

export function MonitorsField({
  monitors,
  agents,
  legacyProbes,
  at,
  onChange,
}: {
  monitors: MonitorConfig[];
  agents: AgentDecl[];
  /** Legacy `probes` still in the config (they run as http monitors on builtin). */
  legacyProbes: number;
  at: At;
  onChange: (monitors: MonitorConfig[]) => void;
}) {
  const runners = [BUILTIN_RUNNER, ...agents.map((a) => a.id)];
  const update = (i: number, next: MonitorConfig) => onChange(monitors.map((m, j) => (j === i ? next : m)));
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Monitors</legend>
      {legacyProbes > 0 && (
        <p className="mb-3 text-xs text-muted">
          {legacyProbes === 1 ? "1 legacy probe" : `${legacyProbes} legacy probes`} under{" "}
          <span className="font-mono">probes</span> also run as HTTP monitors on builtin (edit them in the
          JSON tab; a monitor with the same id replaces one).
        </p>
      )}
      <div className="flex flex-col gap-3">
        {monitors.map((m, i) => (
          <MonitorRow
            key={i}
            monitor={m}
            runners={runners}
            at={(p) => at(`monitors.${i}${p ? `.${p}` : ""}`)}
            onChange={(next) => update(i, next)}
            onMove={(by) => onChange(move(monitors, i, by))}
            first={i === 0}
            last={i === monitors.length - 1}
            onRemove={() => onChange(monitors.filter((_, j) => j !== i))}
          />
        ))}
      </div>
      <IssueText issues={at("monitors").filter((x) => x.path === "monitors")} />
      <Button
        className="mt-3"
        disabled={monitors.length >= 200}
        onClick={() => onChange([...monitors, newMonitor(monitors)])}
      >
        Add monitor
      </Button>
    </fieldset>
  );
}

function MonitorRow({
  monitor: m,
  runners,
  at,
  onChange,
  onMove,
  onRemove,
  first,
  last,
}: {
  monitor: MonitorConfig;
  runners: string[];
  at: At;
  onChange: (m: MonitorConfig) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  first: boolean;
  last: boolean;
}) {
  const set = (patch: Partial<MonitorConfig>) => onChange({ ...m, ...patch } as MonitorConfig);
  const cloudflareSkips = m.runners.includes(BUILTIN_RUNNER) && !RUNNER_TYPES.cloudflare.includes(m.type);
  const unknownRunners = m.runners.filter((r) => !runners.includes(r));
  return (
    <div role="group" aria-label={`Monitor ${m.id}`} className="border border-line p-3">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_12rem]">
        <Field label="Id" value={m.id} issues={at("id")} onChange={(e) => set({ id: e.target.value })} />
        <Field
          label="Name"
          value={m.name}
          issues={at("name")}
          onChange={(e) => set({ name: e.target.value })}
        />
        <SelectField
          label="Type"
          value={m.type}
          onChange={(e) => onChange(withType(m, e.target.value as MonitorType))}
        >
          {MONITOR_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </SelectField>
      </div>
      <p className="mt-1 font-mono text-xs text-faint">service {monitorServiceId(m.id)}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TypeFields monitor={m} at={at} onChange={onChange} />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field
          label="Interval (s)"
          type="number"
          min={60}
          step={60}
          value={num(m.intervalS)}
          issues={at("intervalS")}
          onChange={(e) => set({ intervalS: e.target.valueAsNumber })}
        />
        <Field
          label="Timeout (s)"
          type="number"
          min={1}
          max={30}
          value={num(m.timeoutS)}
          issues={at("timeoutS")}
          onChange={(e) => set({ timeoutS: e.target.valueAsNumber })}
        />
        <Field
          label="Retries"
          type="number"
          min={0}
          max={10}
          value={num(m.retries)}
          issues={at("retries")}
          onChange={(e) => set({ retries: e.target.valueAsNumber })}
        />
      </div>

      <div className="mt-3 grid items-start gap-3 sm:grid-cols-[1fr_12rem]">
        <div>
          <p className="text-xs text-muted">Runners</p>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {[...runners, ...unknownRunners].map((r) => (
              <li key={r}>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={m.runners.includes(r)}
                    onChange={(e) =>
                      set({
                        runners: e.target.checked
                          ? [...runners, ...unknownRunners].filter((x) => x === r || m.runners.includes(x))
                          : m.runners.filter((x) => x !== r),
                      })
                    }
                  />
                  <span className="font-mono">{r}</span>
                  {!runners.includes(r) && <span className="text-xs text-down">(not declared)</span>}
                </label>
              </li>
            ))}
          </ul>
          <IssueText issues={at("runners")} />
        </div>
        <Field
          label="Quorum"
          type="number"
          min={1}
          max={Math.max(1, m.runners.length)}
          placeholder={`${effectiveQuorum({ runners: m.runners, quorum: undefined })} (majority)`}
          value={num(m.quorum)}
          issues={at("quorum")}
          onChange={(e) =>
            set({ quorum: Number.isNaN(e.target.valueAsNumber) ? undefined : e.target.valueAsNumber })
          }
        />
      </div>
      {cloudflareSkips && (
        <p role="note" className="mt-2 text-xs text-degraded">
          On Cloudflare, builtin cannot run {TYPE_LABEL[m.type]} checks and skips this monitor; the Docker
          server and agents run it.
        </p>
      )}
      {m.type === "tcp" && m.runners.includes(BUILTIN_RUNNER) && (
        <p role="note" className="mt-2 text-xs text-muted">
          On Cloudflare, builtin cannot open TCP connections to hosts behind Cloudflare itself (the Workers
          socket limit); check those with an HTTP monitor or from an agent.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="mr-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={m.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Enabled
        </label>
        <Button onClick={() => onMove(-1)} disabled={first}>
          Move up
        </Button>
        <Button onClick={() => onMove(1)} disabled={last}>
          Move down
        </Button>
        <Button tone="danger" onClick={onRemove}>
          Remove monitor
        </Button>
      </div>
    </div>
  );
}

function TypeFields({
  monitor: m,
  at,
  onChange,
}: {
  monitor: MonitorConfig;
  at: At;
  onChange: (m: MonitorConfig) => void;
}) {
  switch (m.type) {
    case "http": {
      const set = (patch: Partial<typeof m>) => onChange({ ...m, ...patch });
      return (
        <>
          <Field
            label="URL"
            type="url"
            value={m.url}
            issues={at("url")}
            onChange={(e) => set({ url: e.target.value })}
          />
          <SelectField
            label="Method"
            value={m.method}
            onChange={(e) => set({ method: e.target.value as "GET" | "HEAD" })}
          >
            <option value="GET">GET</option>
            <option value="HEAD">HEAD</option>
          </SelectField>
          <Field
            label="Expected status from"
            type="number"
            min={100}
            max={599}
            value={num(m.expectStatus.min)}
            issues={at("expectStatus.min")}
            onChange={(e) => set({ expectStatus: { ...m.expectStatus, min: e.target.valueAsNumber } })}
          />
          <Field
            label="Expected status to"
            type="number"
            min={100}
            max={599}
            value={num(m.expectStatus.max)}
            issues={[
              ...at("expectStatus.max"),
              ...at("expectStatus").filter((x) => x.path.endsWith("expectStatus")),
            ]}
            onChange={(e) => set({ expectStatus: { ...m.expectStatus, max: e.target.valueAsNumber } })}
          />
          <Field
            label="Keyword (optional)"
            value={m.keyword ?? ""}
            issues={at("keyword")}
            onChange={(e) => set({ keyword: e.target.value || undefined })}
          />
          <label className="flex items-center gap-2 self-end pb-2 text-sm">
            <input
              type="checkbox"
              checked={m.keywordAbsent}
              disabled={!m.keyword}
              onChange={(e) => set({ keywordAbsent: e.target.checked })}
            />
            Up when the keyword is absent
          </label>
        </>
      );
    }
    case "tcp":
    case "tls": {
      const set = (patch: Partial<typeof m>) => onChange({ ...m, ...patch } as MonitorConfig);
      return (
        <>
          <Field
            label="Host"
            value={m.host}
            issues={at("host")}
            onChange={(e) => set({ host: e.target.value })}
          />
          <Field
            label="Port"
            type="number"
            min={1}
            max={65535}
            value={num(m.port)}
            issues={at("port")}
            onChange={(e) => set({ port: e.target.valueAsNumber })}
          />
          {m.type === "tls" && (
            <>
              <Field
                label="Server name (SNI, optional)"
                value={m.servername ?? ""}
                issues={at("servername")}
                onChange={(e) => onChange({ ...m, servername: e.target.value || undefined })}
              />
              <Field
                label="Degraded under (days left)"
                type="number"
                min={0}
                max={365}
                value={num(m.minDays)}
                issues={at("minDays")}
                onChange={(e) => onChange({ ...m, minDays: e.target.valueAsNumber })}
              />
            </>
          )}
        </>
      );
    }
    case "ping":
      return (
        <Field
          label="Host"
          value={m.host}
          issues={at("host")}
          onChange={(e) => onChange({ ...m, host: e.target.value })}
        />
      );
  }
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

export function AgentsField({
  agents,
  monitors,
  at,
  onChange,
}: {
  agents: AgentDecl[];
  monitors: MonitorConfig[];
  at: At;
  onChange: (agents: AgentDecl[]) => void;
}) {
  const update = (i: number, next: Partial<AgentDecl>) =>
    onChange(agents.map((a, j) => (j === i ? { ...a, ...next } : a)));
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Agents</legend>
      <p className="mb-3 text-xs text-muted">
        An agent (uptellis-agent) runs monitors from inside a private network and reports as{" "}
        <span className="font-mono">probe:&lt;id&gt;</span>; its API key needs the agent scope.
      </p>
      <div className="flex flex-col gap-3">
        {agents.map((a, i) => {
          const used = monitors.filter((m) => m.runners.includes(a.id)).length;
          return (
            <div
              key={i}
              role="group"
              aria-label={`Agent ${a.id}`}
              className="grid items-end gap-2 sm:grid-cols-[12rem_1fr_auto]"
            >
              <Field
                label="Id"
                value={a.id}
                issues={at(`agents.${i}.id`)}
                onChange={(e) => update(i, { id: e.target.value })}
              />
              <Field
                label="Name"
                value={a.name}
                issues={at(`agents.${i}.name`)}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              <Button tone="danger" onClick={() => onChange(agents.filter((_, j) => j !== i))}>
                Remove agent
              </Button>
              {used > 0 && (
                <p className="text-xs text-muted sm:col-span-3">
                  Runs {used === 1 ? "1 monitor" : `${used} monitors`}.
                </p>
              )}
            </div>
          );
        })}
      </div>
      <Button
        className="mt-3"
        disabled={agents.length >= 20}
        onClick={() => onChange([...agents, { id: freeId("agent", agents), name: "New agent" }])}
      >
        Add agent
      </Button>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */
/* Maintenance                                                         */
/* ------------------------------------------------------------------ */

/** `2026-09-28T10:00:00Z` -> `2026-09-28T10:00` for a `datetime-local` input (UTC). */
export const toLocalInput = (iso: string) => /^\d{4}-\d\d-\d\dT\d\d:\d\d/.exec(iso)?.[0] ?? "";
/** Back from the input: whole minutes, UTC. */
export const fromLocalInput = (v: string) => (v ? `${v.slice(0, 16)}:00Z` : "");

/** Every IANA zone the runtime knows (with UTC), for the weekly window's select. */
function timeZones(current: readonly string[]): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  return [...new Set(["UTC", ...zones, ...current])].sort((a, b) =>
    a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b),
  );
}

function browserZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function newWindow(
  kind: MaintenanceWindow["kind"],
  id: string,
  title: string,
  services: string[],
  nowMs: number,
): MaintenanceWindow {
  if (kind === "weekly") {
    return {
      kind,
      id,
      title,
      services,
      days: ["sun"],
      start: "02:00",
      durationMin: 60,
      timeZone: browserZone(),
    };
  }
  const hour = Math.ceil(nowMs / 3_600_000) * 3_600_000;
  const iso = (t: number) => new Date(t).toISOString().replace(".000Z", "Z");
  return { kind, id, title, services, start: iso(hour), end: iso(hour + 3_600_000) };
}

export function MaintenanceField({
  windows,
  services,
  at,
  onChange,
}: {
  windows: MaintenanceWindow[];
  /** Services a window can cover: id and display name. */
  services: [string, string][];
  at: At;
  onChange: (windows: MaintenanceWindow[]) => void;
}) {
  const zones = useMemo(
    () => timeZones(windows.flatMap((w) => (w.kind === "weekly" ? [w.timeZone] : []))),
    [windows],
  );
  const update = (i: number, next: MaintenanceWindow) =>
    onChange(windows.map((w, j) => (j === i ? next : w)));
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Maintenance windows</legend>
      <p className="mb-3 text-xs text-muted">
        Services inside an active window show maintenance, open no incident and send no card.
      </p>
      <div className="flex flex-col gap-3">
        {windows.map((w, i) => {
          const p = (f: string) => at(`maintenance.${i}.${f}`);
          const set = (patch: Partial<MaintenanceWindow>) =>
            update(i, { ...w, ...patch } as MaintenanceWindow);
          return (
            <div key={i} role="group" aria-label={`Window ${w.id}`} className="border border-line p-3">
              <div className="grid gap-3 sm:grid-cols-[10rem_1fr_10rem]">
                <Field
                  label="Id"
                  value={w.id}
                  issues={p("id")}
                  onChange={(e) => set({ id: e.target.value })}
                />
                <Field
                  label="Title"
                  value={w.title}
                  issues={p("title")}
                  onChange={(e) => set({ title: e.target.value })}
                />
                <SelectField
                  label="Repeats"
                  value={w.kind}
                  onChange={(e) =>
                    update(
                      i,
                      newWindow(
                        e.target.value as MaintenanceWindow["kind"],
                        w.id,
                        w.title,
                        w.services,
                        Date.now(),
                      ),
                    )
                  }
                >
                  <option value="once">Once</option>
                  <option value="weekly">Weekly</option>
                </SelectField>
              </div>

              {w.kind === "once" ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Start (UTC)"
                    type="datetime-local"
                    value={toLocalInput(w.start)}
                    issues={p("start")}
                    onChange={(e) => set({ start: fromLocalInput(e.target.value) })}
                  />
                  <Field
                    label="End (UTC)"
                    type="datetime-local"
                    value={toLocalInput(w.end)}
                    issues={p("end")}
                    onChange={(e) => set({ end: fromLocalInput(e.target.value) })}
                  />
                </div>
              ) : (
                <>
                  <div className="mt-3">
                    <p className="text-xs text-muted">Days</p>
                    <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                      {WEEKDAYS.map((d) => (
                        <li key={d}>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={w.days.includes(d)}
                              onChange={(e) =>
                                set({
                                  days: e.target.checked
                                    ? WEEKDAYS.filter((x) => x === d || w.days.includes(x))
                                    : w.days.filter((x) => x !== d),
                                })
                              }
                            />
                            {DAY_LABEL[d]}
                          </label>
                        </li>
                      ))}
                    </ul>
                    <IssueText issues={p("days")} />
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Field
                      label="Starts at"
                      type="time"
                      value={w.start}
                      issues={p("start")}
                      onChange={(e) => set({ start: e.target.value })}
                    />
                    <Field
                      label="Duration (min)"
                      type="number"
                      min={1}
                      max={1440}
                      value={num(w.durationMin)}
                      issues={p("durationMin")}
                      onChange={(e) => set({ durationMin: e.target.valueAsNumber })}
                    />
                    <div>
                      <SelectField
                        label="Time zone"
                        value={w.timeZone}
                        onChange={(e) => set({ timeZone: e.target.value })}
                      >
                        {zones.map((z) => (
                          <option key={z} value={z}>
                            {z}
                          </option>
                        ))}
                      </SelectField>
                      <IssueText issues={p("timeZone")} />
                    </div>
                  </div>
                </>
              )}

              <p className="mt-3 text-xs text-muted">
                Services {w.services.length === 0 && <span>(none checked: every service of the site)</span>}
              </p>
              <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                {services.map(([id, name]) => (
                  <li key={id}>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={w.services.includes(id)}
                        onChange={(e) =>
                          set({
                            services: e.target.checked
                              ? [...w.services, id]
                              : w.services.filter((x) => x !== id),
                          })
                        }
                      />
                      <span className="truncate">{name}</span>
                      <span className="truncate font-mono text-xs text-faint">{id}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <IssueText issues={p("services")} />
              <div className="mt-3">
                <Button tone="danger" onClick={() => onChange(windows.filter((_, j) => j !== i))}>
                  Remove window
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={windows.length >= 50}
          onClick={() =>
            onChange([
              ...windows,
              newWindow("once", freeId("window", windows), "Maintenance", [], Date.now()),
            ])
          }
        >
          Add one-off window
        </Button>
        <Button
          disabled={windows.length >= 50}
          onClick={() =>
            onChange([
              ...windows,
              newWindow("weekly", freeId("window", windows), "Maintenance", [], Date.now()),
            ])
          }
        >
          Add weekly window
        </Button>
      </div>
    </fieldset>
  );
}

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

export function AlertsField({
  notify,
  onChange,
}: {
  notify: SiteConfig["notify"];
  onChange: (notify: SiteConfig["notify"]) => void;
}) {
  // `channelsOf` drops the built-in channel once a configured one takes its secret or id.
  const replaced = notify.channels.some(
    (c) => ("secret" in c && c.secret === LEGACY_DISCORD_SECRET) || c.id === LEGACY_DISCORD_CHANNEL,
  );
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Alerts</legend>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={notify.discord}
          onChange={(e) => onChange({ ...notify, discord: e.target.checked })}
        />
        <span>
          Discord cards when a service goes down and comes back up
          <span className="block text-xs text-muted">
            Posted to the DISCORD_WEBHOOK_URL webhook by the built-in Discord channel (listed under
            notification channels), never for a service in maintenance. Cards for silent sources are always
            sent.
          </span>
        </span>
      </label>
      {replaced && (
        <p className="mt-2 text-xs text-muted">
          A configured channel uses DISCORD_WEBHOOK_URL, so the built-in channel is off and this switch has no
          effect: choose that channel's events instead.
        </p>
      )}
    </fieldset>
  );
}
