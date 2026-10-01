/**
 * The first-run screen, "What should we watch?" (`/admin/welcome`): step 1 the address to check (its type
 * inferred as in the New monitor drawer), step 2 where alerts go (one tile per channel type, with the one
 * value it needs; a secret-backed type only names the secret to set on the server). "Start monitoring"
 * saves the monitor and the channel as one change through `useSiteConfig`; "Skip for now" goes to the
 * dashboard. A test alert can be sent once the channel is saved.
 */
import { type FormEvent, useId, useState } from "react";
import { monitorServiceId } from "@/shared/monitors";
import type { ChannelType } from "@/shared/notify";
import type { ConfigState } from "@/shared/schemas/admin";
import { cx } from "../../../kit/cx";
import { isSaved } from "../ChannelsEditor";
import { testChannel } from "../client";
import { AdminIcon } from "../icons";
import { Button, inputClass, Notice } from "../ui";
import { applyChange, useSiteConfig } from "../useSiteConfig";
import {
  type ChannelDraft,
  channelFromDraft,
  emptyChannelDraft,
  FIRST_CHANNEL_TYPES,
  FIRST_RUN_NOTE,
  firstRunChange,
  monitorFromAddress,
  plainChannelIssue,
  rememberTestAlert,
  SECRET_HOLDS,
  TILE_LABEL,
} from "./firstRun";
import { plainMonitorIssue } from "./MonitorForm";
import { inferType, KIND_LABEL } from "./model";
import { CodeBox } from "./parts";

export interface FirstRunProps {
  site: string;
  state: ConfigState;
  onReload: () => void;
  /** After "Start monitoring" saved: the new monitor's service id (the dashboard opens its details). */
  onDone: (serviceId: string) => void;
  onSkip: () => void;
}

export function FirstRun({ site, state, onReload, onDone, onSkip }: FirstRunProps) {
  const cfg = useSiteConfig({ site, state, onReload });
  const id = useId();
  const f = (name: string) => `${id}-${name}`;
  const [target, setTarget] = useState("");
  const [ch, setCh] = useState<ChannelDraft>(() => emptyChannelDraft());
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ busy: boolean; message: string | null; ok: boolean }>({
    busy: false,
    message: null,
    ok: false,
  });
  const set = (patch: Partial<ChannelDraft>) => setCh((x) => ({ ...x, ...patch }));

  const config = cfg.config;
  const monitor = monitorFromAddress(target, config.monitors);
  // The channel's id is chosen against the channels there were on arrival, so once saved it is the same one.
  const [arrived] = useState(() => state.config.notify.channels);
  const channel = channelFromDraft(ch, arrived);
  const checked = applyChange(config, firstRunChange(monitor, channel));
  const issues = checked.ok ? [] : checked.issues;
  const mi = config.monitors.length;
  const ci = config.notify.channels.findIndex((c) => c.id === channel.id);
  const at = ci < 0 ? config.notify.channels.length : ci;
  const targetIssues = !tried
    ? []
    : target.trim() === ""
      ? ["Enter the address to check."]
      : issues.flatMap((i) => {
          const m = new RegExp(`^monitors\\.${mi}\\.(url|host|port|name)\\b`).exec(i.path);
          return m ? [plainMonitorIssue(i, m[1]!)] : [];
        });
  const channelIssues = (field: string) =>
    tried
      ? [
          ...new Set(
            issues
              .filter(
                (i) =>
                  i.path === `notify.channels.${at}.${field}` ||
                  i.path.startsWith(`notify.channels.${at}.${field}.`),
              )
              .map((i) => plainChannelIssue(i, ch.type)),
          ),
        ]
      : [];
  const otherIssues = tried
    ? issues
        .filter((i) => !i.path.startsWith(`monitors.${mi}.`) && !i.path.startsWith(`notify.channels.${at}.`))
        .map((i) => i.message)
    : [];

  const canTest = isSaved(channel, config.notify);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (!checked.ok || target.trim() === "") return;
    const out = await cfg.save(firstRunChange(monitor, channel), FIRST_RUN_NOTE);
    if (!out.ok) {
      setError(out.message);
      return;
    }
    onDone(monitorServiceId(monitor.id));
  };

  const sendTest = async () => {
    setTest({ busy: true, message: null, ok: false });
    const r = await testChannel(site, channel.id, "down");
    if (r.sent) rememberTestAlert(site);
    setTest({
      busy: false,
      ok: r.sent,
      message: r.sent
        ? `Test alert sent to ${channel.name}. Check that it arrived.`
        : `The test alert did not go through${"message" in r && r.message ? `: ${r.message}` : ` (${r.error})`}. Check the ${channel.name} settings under Alerts.`,
    });
  };

  const inferred = target.trim() ? KIND_LABEL[inferType(target)] : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 py-4">
      <form
        id="first-run-form"
        noValidate
        onSubmit={(e) => void start(e)}
        className="flex flex-col gap-8 border border-line bg-panel p-6 max-sm:p-4"
      >
        <header>
          <h1 className="text-2xl font-bold text-ink">What should we watch?</h1>
          <p className="mt-1 text-muted">Two things and you are done. It takes about a minute.</p>
        </header>
        {error && <Notice tone="error">{error}</Notice>}

        <section aria-labelledby={f("s1")} className="flex flex-col gap-2">
          <h2 id={f("s1")} className="flex items-center gap-2 font-semibold text-ink">
            <Step n={1} />
            Your website or server
          </h2>
          <label htmlFor={f("target")} className="text-sm font-medium text-ink">
            Address to check
          </label>
          <input
            id={f("target")}
            data-first-target
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://example.com"
            value={target}
            aria-invalid={targetIssues.length > 0 || undefined}
            aria-describedby={f("target-hint")}
            onChange={(e) => setTarget(e.target.value)}
            className={cx(inputClass, "py-2.5 text-base", targetIssues.length > 0 && "border-down")}
          />
          <p id={f("target-hint")} className="text-xs text-muted">
            {targetIssues.length ? (
              <span className="text-down">{targetIssues.join(" ")}</span>
            ) : inferred ? (
              `We check it every minute (${inferred}) from the Cloudflare edge or this server.`
            ) : (
              "A web address, a host with a port (db.example.com:5432) or just a host name."
            )}
          </p>
        </section>

        <section aria-labelledby={f("s2")} className="flex flex-col gap-3">
          <h2 id={f("s2")} className="flex items-center gap-2 font-semibold text-ink">
            <Step n={2} />
            Where should we alert you?
          </h2>
          <fieldset>
            <legend className="sr-only">Alert channel</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FIRST_CHANNEL_TYPES.map((t) => (
                <label
                  key={t}
                  className="flex cursor-pointer items-center gap-2 border border-line px-3 py-2.5 text-sm has-checked:border-accent has-checked:bg-raised has-checked:font-semibold"
                >
                  <input
                    type="radio"
                    name={f("type")}
                    value={t}
                    checked={ch.type === t}
                    onChange={() => {
                      set({ type: t });
                      setTest({ busy: false, message: null, ok: false });
                    }}
                    className="accent-(--color-accent)"
                  />
                  {TILE_LABEL[t]}
                </label>
              ))}
            </div>
          </fieldset>
          <ChannelFields
            draft={ch}
            set={set}
            f={f}
            issues={channelIssues}
            secret={"secret" in channel ? channel.secret : null}
          />
          <div className="flex flex-col gap-1">
            <div>
              <Button onClick={() => void sendTest()} disabled={!canTest || test.busy}>
                <AdminIcon name="send" size={14} />
                Send a test alert
              </Button>
            </div>
            <p role="status" className={cx("text-sm", test.message && !test.ok ? "text-down" : "text-muted")}>
              {test.busy
                ? "Sending..."
                : (test.message ??
                  (canTest
                    ? ""
                    : "You can send a test once this channel is saved. Start monitoring saves it."))}
            </p>
          </div>
        </section>

        {otherIssues.length > 0 && <Notice tone="error">{otherIssues.join(" ")}</Notice>}
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="primary" type="submit" disabled={cfg.saving} className="px-5 py-2.5 text-base">
            Start monitoring
          </Button>
          <Button onClick={onSkip} disabled={cfg.saving} className="py-2.5">
            Skip for now
          </Button>
          {cfg.saving && (
            <span role="status" className="text-sm text-muted">
              Saving...
            </span>
          )}
        </div>
      </form>
      <p className="text-center text-sm text-muted">
        Moving from another tool?{" "}
        <a href="/admin/settings/import-export" className="text-accent underline">
          Import your setup
        </a>{" "}
        in Settings.
      </p>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-(--color-base)"
    >
      {n}
    </span>
  );
}

function ChannelFields({
  draft,
  set,
  f,
  issues,
  secret,
}: {
  draft: ChannelDraft;
  set: (patch: Partial<ChannelDraft>) => void;
  f: (name: string) => string;
  issues: (field: string) => string[];
  /** The secret the channel reads, for a secret-backed type. */
  secret: string | null;
}) {
  const t: ChannelType = draft.type;
  return (
    <div className="flex flex-col gap-4">
      {t === "email" && (
        <TextField
          id={f("emails")}
          label="Email addresses"
          type="email"
          value={draft.emails}
          placeholder="One or more addresses"
          issues={issues("to")}
          hint="Separate several with commas. Sent by this server's email sender."
          onChange={(v) => set({ emails: v })}
        />
      )}
      {t === "telegram" && (
        <TextField
          id={f("chat")}
          label="Chat ID"
          value={draft.chatId}
          placeholder="-1001234567890 or @yourchannel"
          issues={issues("chatId")}
          hint="The chat, group or channel the bot posts in."
          onChange={(v) => set({ chatId: v })}
        />
      )}
      {t === "sms" && (
        <>
          <TextField
            id={f("sms-to")}
            label="Phone number to text"
            type="tel"
            value={draft.smsTo}
            placeholder="+15551234567"
            issues={issues("to")}
            hint="With its country code. Texts cost money, so only down and back up are sent."
            onChange={(v) => set({ smsTo: v })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id={f("sms-from")}
              label="Send from (Twilio number)"
              value={draft.smsFrom}
              placeholder="+15557654321"
              issues={issues("from")}
              onChange={(v) => set({ smsFrom: v })}
            />
            <TextField
              id={f("sms-sid")}
              label="Twilio Account SID"
              value={draft.accountSid}
              placeholder="AC..."
              issues={issues("accountSid")}
              onChange={(v) => set({ accountSid: v })}
            />
          </div>
        </>
      )}
      {secret && t !== "email" && (
        <div className="flex flex-col gap-1" data-secret-note>
          <CodeBox label="Secret name on the server" value={secret} />
          <p className="text-xs text-muted">
            Save {SECRET_HOLDS[t]} on the server under this name:{" "}
            <span className="font-mono">wrangler secret put {secret}</span> on Cloudflare, or the{" "}
            <span className="font-mono">{secret}</span> environment variable in Docker. It is never stored
            here.
          </p>
        </div>
      )}
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  placeholder,
  issues,
  hint,
  type = "text",
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  issues: string[];
  hint?: string;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={issues.length > 0 || undefined}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
        className={cx(inputClass, "mt-1", issues.length > 0 && "border-down")}
      />
      <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
        {issues.length ? <span className="text-down">{issues.join(" ")}</span> : (hint ?? "")}
      </p>
    </div>
  );
}
