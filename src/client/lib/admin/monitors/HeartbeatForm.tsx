/**
 * The New heartbeat drawer (and Edit for an existing one): "Expect a heartbeat every [N] [unit] with a
 * grace period of [N] [unit]" and a name. Creating saves the push monitor through the save path, then asks
 * the server for its address (`issuePushUrl`, the same call as the full editor's "Create push URL") and
 * shows it once with Copy, a ready curl line and the pending state. Editing changes the schedule and name
 * only; a new address comes from the heartbeat's detail drawer.
 */
import { type FormEvent, useId, useState } from "react";
import type { SiteConfig } from "@/shared/config";
import type { PushMonitor } from "@/shared/monitors";
import { cx } from "../../../kit/cx";
import { describeFailure, issuePushUrl } from "../client";
import { Drawer } from "../Drawer";
import { pushCurl } from "../MonitorsEditor";
import { useToast } from "../Toast";
import { Button, inputClass, Notice } from "../ui";
import type { SiteConfigApi } from "../useSiteConfig";
import { applyChange } from "../useSiteConfig";
import { durationWords, newHeartbeat, upsertMonitor } from "./model";
import { CodeBox, PendingBox } from "./parts";

const UNITS = { minutes: 60, hours: 3600, days: 86_400 } as const;
type Unit = keyof typeof UNITS;
const GRACE_UNITS = { minutes: 60, hours: 3600 } as const;
type GraceUnit = keyof typeof GRACE_UNITS;

/** Seconds as the largest whole unit: 7200 is 2 hours, 90 is 1.5 minutes. */
function split<U extends string>(s: number, units: Record<U, number>): [number, U] {
  const order = (Object.entries(units) as [U, number][]).sort((a, b) => b[1] - a[1]);
  for (const [u, n] of order) if (s % n === 0 && s >= n) return [s / n, u];
  const smallest = order[order.length - 1]!;
  return [s / smallest[1], smallest[0]];
}

export interface HeartbeatFormProps {
  open: boolean;
  onClose: () => void;
  site: string;
  config: SiteConfig;
  save: SiteConfigApi["save"];
  /** The heartbeat being edited; null for a new one. */
  editing: PushMonitor | null;
}

export function HeartbeatForm(props: HeartbeatFormProps) {
  const [issued, setIssued] = useState(false);
  const { open, onClose, editing } = props;
  // The next opening starts from the form again.
  if (!open && issued) setIssued(false);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : "New heartbeat"}
      initialFocus="[data-heartbeat-name]"
      footer={
        issued ? (
          <>
            <span className="mr-auto text-xs text-muted">Saved already. You can change it any time.</span>
            <Button tone="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button tone="primary" type="submit" form="heartbeat-form">
              {editing ? "Save changes" : "Create heartbeat"}
            </Button>
          </>
        )
      }
    >
      <HeartbeatFields key={editing?.id ?? "new"} {...props} onIssued={() => setIssued(true)} />
    </Drawer>
  );
}

function HeartbeatFields({
  site,
  config,
  save,
  editing,
  onClose,
  onIssued,
}: HeartbeatFormProps & { onIssued: () => void }) {
  const toast = useToast();
  const id = useId();
  const [name, setName] = useState(editing?.name ?? "");
  const [every, setEvery] = useState(() => split(editing?.intervalS ?? 3600, UNITS));
  const [grace, setGrace] = useState(() => split(editing?.graceS ?? 300, GRACE_UNITS));
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ name: string; url: string | null; failure: string | null } | null>(null);

  const intervalS = Math.round(every[0] * UNITS[every[1]]);
  const graceS = Math.round(grace[0] * GRACE_UNITS[grace[1]]);
  const monitor: PushMonitor = editing
    ? { ...editing, name: name.trim(), intervalS, graceS }
    : (newHeartbeat(config.monitors, { name, intervalS, graceS }) as PushMonitor);
  const checked = applyChange(config, upsertMonitor(monitor));
  const index = config.monitors.some((m) => m.id === monitor.id)
    ? config.monitors.findIndex((m) => m.id === monitor.id)
    : config.monitors.length;
  const issueAt = (field: string) =>
    tried && !checked.ok ? checked.issues.filter((i) => i.path === `monitors.${index}.${field}`) : [];
  const nameBad = issueAt("name").length > 0;
  const scheduleBad = issueAt("intervalS").length + issueAt("graceS").length > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (!checked.ok) return;
    setBusy(true);
    const out = await save(
      upsertMonitor(monitor),
      editing ? `Changed heartbeat ${monitor.name}` : `Added heartbeat ${monitor.name}`,
    );
    if (!out.ok) {
      setBusy(false);
      setError(out.message);
      return;
    }
    if (editing) {
      setBusy(false);
      toast(`Saved ${monitor.name}`);
      onClose();
      return;
    }
    toast(`Added heartbeat ${monitor.name}`);
    try {
      const url = await issuePushUrl(site, monitor.id);
      setDone({ name: monitor.name, url: url.url, failure: null });
    } catch (err) {
      setDone({ name: monitor.name, url: null, failure: describeFailure(err).message });
    }
    setBusy(false);
    onIssued();
  };

  if (done) {
    return (
      <div className="flex flex-col gap-5">
        {done.url ? (
          <section aria-labelledby={`${id}-url`} className="flex flex-col gap-3">
            <h3 id={`${id}-url`} className="font-semibold text-ink">
              Your heartbeat address
            </h3>
            <p className="text-sm text-muted">Call this address at the end of your job. Any request works.</p>
            <CodeBox label="Heartbeat address" value={done.url} />
            <CodeBox label="Or add this line to the end of your script" value={pushCurl(done.url)} />
            <Notice tone="warn">
              <strong>Shown once.</strong> Copy it now. The address works like a password: if you lose it,
              make a new one from the heartbeat's details and the old one stops working.
            </Notice>
          </section>
        ) : (
          <Notice tone="error">
            {done.name} is saved, but its address could not be made: {done.failure} Open it from the list and
            choose Make a new address.
          </Notice>
        )}
        <PendingBox title="Pending, waiting for the first heartbeat">
          Run your job or the curl line above. This turns green as soon as the first ping arrives.
        </PendingBox>
      </div>
    );
  }

  const f = (n: string) => `${id}-${n}`;
  return (
    <form id="heartbeat-form" noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
      {error && <Notice tone="error">{error}</Notice>}
      <div>
        <label htmlFor={f("name")} className="block text-sm font-medium text-ink">
          Name
        </label>
        <input
          id={f("name")}
          data-heartbeat-name
          type="text"
          value={name}
          placeholder="For example: Nightly backup"
          aria-invalid={nameBad || undefined}
          aria-describedby={nameBad ? f("name-issue") : undefined}
          onChange={(e) => setName(e.target.value)}
          className={cx(inputClass, "mt-1", nameBad && "border-down")}
        />
        {nameBad && (
          <p id={f("name-issue")} className="mt-1 text-xs text-down">
            Give it a name.
          </p>
        )}
      </div>
      <fieldset>
        <legend className="text-sm font-medium text-ink">When should it check in?</legend>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor={f("every")}>Expect a heartbeat every</label>
          <input
            id={f("every")}
            type="number"
            min={1}
            value={Number.isFinite(every[0]) ? every[0] : ""}
            onChange={(e) => setEvery([e.target.valueAsNumber, every[1]])}
            className={cx(inputClass, "w-20")}
          />
          <label htmlFor={f("every-unit")} className="sr-only">
            Unit
          </label>
          <select
            id={f("every-unit")}
            value={every[1]}
            onChange={(e) => setEvery([every[0], e.target.value as Unit])}
            className={cx(inputClass, "w-auto")}
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
            <option value="days">days</option>
          </select>
          <label htmlFor={f("grace")}>with a grace period of</label>
          <input
            id={f("grace")}
            type="number"
            min={0}
            value={Number.isFinite(grace[0]) ? grace[0] : ""}
            onChange={(e) => setGrace([e.target.valueAsNumber, grace[1]])}
            className={cx(inputClass, "w-20")}
          />
          <label htmlFor={f("grace-unit")} className="sr-only">
            Grace unit
          </label>
          <select
            id={f("grace-unit")}
            value={grace[1]}
            onChange={(e) => setGrace([grace[0], e.target.value as GraceUnit])}
            className={cx(inputClass, "w-auto")}
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
          </select>
        </div>
        <p role="status" className={cx("mt-2 text-xs", scheduleBad ? "text-down" : "text-muted")}>
          {scheduleBad
            ? "Expect it between every minute and once a day, with a grace period of at most a day."
            : Number.isFinite(intervalS + graceS) && intervalS > 0
              ? `If nothing arrives within ${durationWords(intervalS + graceS)} of the last ping, we alert you.`
              : ""}
        </p>
      </fieldset>
      <div>
        <p className="text-sm font-medium text-ink">Alert</p>
        <p className="mt-1 text-sm text-muted">
          All alert channels. Choose what each channel covers under Alerts.
        </p>
      </div>
      {busy && (
        <p role="status" className="text-sm text-muted">
          Saving...
        </p>
      )}
    </form>
  );
}
