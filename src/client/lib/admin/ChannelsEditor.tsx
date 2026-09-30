/**
 * Notification channels in the config editor (Phase 6b): `notify.channels` as rows with per-type fields,
 * events and a service filter, plus the historical Discord channel that `channelsOf` adds, shown read-only.
 * Rows edit the editor's draft, so saving goes through its review and save (a new revision, `config.edit`)
 * and every issue comes from the same `ChannelConfig` schema the server applies. A channel names the
 * secret that holds its URL or token, never the value; a saved channel can be sent a TEST message.
 */
import { type ReactNode, useState } from "react";
import type { SiteConfig } from "@/shared/config";
import {
  CHANNEL_TYPES,
  type ChannelConfig,
  type ChannelType,
  channelsOf,
  LEGACY_DISCORD_CHANNEL,
  LEGACY_DISCORD_SECRET,
  NOTIFY_EVENTS,
  type NotifyEvent,
} from "@/shared/notify";
import type { ConfigIssue } from "@/shared/schemas/admin";
import { type ChannelTestOutcome, type TestKind, testChannel } from "./client";
import { Button, Field, IssueText, SelectField } from "./ui";

type At = (path: string) => ConfigIssue[];
type Notify = SiteConfig["notify"];

export const TYPE_LABEL: Record<ChannelType, string> = {
  discord: "Discord webhook",
  slack: "Slack webhook",
  webhook: "Webhook",
  ntfy: "ntfy",
  telegram: "Telegram",
  email: "Email",
};

export const EVENT_LABEL: Record<NotifyEvent, string> = {
  down: "Service down",
  up: "Service back up",
  stale: "Source silent",
  recovered: "Source back",
};

/** The label of each type's main secret: what the named secret holds. */
const SECRET_LABEL: Record<Exclude<ChannelType, "email">, string> = {
  discord: "Webhook URL secret",
  slack: "Webhook URL secret",
  webhook: "Endpoint URL secret",
  ntfy: "Topic URL secret",
  telegram: "Bot token secret",
};

/**
 * What a secret name input accepts: upper case letters, digits and `_` (`-` and spaces become `_`). The
 * schema then requires `NOTIFY_*` or `DISCORD_WEBHOOK_URL`.
 */
export const toSecretName = (raw: string) =>
  raw
    .toUpperCase()
    .replace(/[-\s]/g, "_")
    .replace(/[^A-Z0-9_]/g, "");

/** `NOTIFY_OPS_SLACK` from `ops-slack`: the suggested secret name of a channel id. */
export const suggestedSecret = (id: string, suffix = "") =>
  toSecretName(`NOTIFY_${id}${suffix}`).slice(0, 63);

const freeId = (taken: readonly { id: string }[]) => {
  let n = taken.length + 1;
  while (taken.some((t) => t.id === `channel-${n}`)) n++;
  return `channel-${n}`;
};

export function newChannel(taken: readonly ChannelConfig[]): ChannelConfig {
  const id = freeId(taken);
  return {
    id,
    name: "New channel",
    type: "discord",
    secret: suggestedSecret(id),
    events: [...NOTIFY_EVENTS],
    services: [],
    enabled: true,
  };
}

/** The channel as `type`, keeping the common fields and the main secret where both types have one. */
export function withChannelType(ch: ChannelConfig, type: ChannelType): ChannelConfig {
  if (ch.type === type) return ch;
  const { id, name, events, services, enabled } = ch;
  const common = { id, name, events, services, enabled };
  const secret = "secret" in ch ? ch.secret : suggestedSecret(id);
  switch (type) {
    case "discord":
    case "slack":
      return { ...common, type, secret };
    case "webhook":
      return { ...common, type, secret, signingSecret: suggestedSecret(id, "_SIGNING") };
    case "ntfy":
      return { ...common, type, secret };
    case "telegram":
      return { ...common, type, secret, chatId: "" };
    case "email":
      return { ...common, type, to: [""] };
  }
}

/** The channel under a new id; secret names still at their suggestion follow it. */
export function withId(ch: ChannelConfig, id: string): ChannelConfig {
  const follow = (name: string | undefined, suffix = "") =>
    name === suggestedSecret(ch.id, suffix) ? suggestedSecret(id, suffix) : name;
  const next = { ...ch, id };
  if ("secret" in next) next.secret = follow(next.secret) ?? next.secret;
  if (next.type === "webhook") {
    next.signingSecret = follow(next.signingSecret, "_SIGNING");
    next.authSecret = follow(next.authSecret, "_AUTH");
  }
  return next;
}

const move = <T,>(list: T[], i: number, by: -1 | 1): T[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether `channel` is saved exactly as in the draft (a test sends what is saved, not the draft). */
export function isSaved(channel: ChannelConfig, saved: Notify): boolean {
  const s = channelsOf(saved).find((c) => c.id === channel.id);
  return !!s && same(s, channel);
}

type TestState = { busy: boolean; outcome: ChannelTestOutcome | null };

/* ------------------------------------------------------------------ */
/* Channels                                                            */
/* ------------------------------------------------------------------ */

export function ChannelsField({
  site,
  notify,
  saved,
  services,
  at,
  onChange,
}: {
  site: string;
  notify: Notify;
  /** The saved `notify`, to tell which channels can be tested. */
  saved: Notify;
  /** Services a channel can be limited to: id and name. */
  services: [string, string][];
  at: At;
  onChange: (notify: Notify) => void;
}) {
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const channels = notify.channels;
  const implicit = channelsOf(notify).filter((c) => !channels.includes(c));
  const setChannels = (next: ChannelConfig[]) => onChange({ ...notify, channels: next });
  const update = (i: number, next: ChannelConfig) =>
    setChannels(channels.map((c, j) => (j === i ? next : c)));

  const runTest = async (id: string, kind: TestKind) => {
    setTests((t) => ({ ...t, [id]: { busy: true, outcome: null } }));
    const outcome = await testChannel(site, id, kind);
    setTests((t) => ({ ...t, [id]: { busy: false, outcome } }));
  };
  const test = (ch: ChannelConfig) => (
    <SendTest
      channel={ch}
      saved={isSaved(ch, saved)}
      state={tests[ch.id]}
      onSend={(kind) => void runTest(ch.id, kind)}
    />
  );

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Notification channels</legend>
      <p className="mb-3 text-xs text-muted">
        Every enabled channel gets the events it is set to, in this order. A channel names the secret that
        holds its URL or token, never the value: set it with{" "}
        <span className="font-mono">wrangler secret put NOTIFY_NAME</span> on Cloudflare, or as the{" "}
        <span className="font-mono">NOTIFY_NAME</span> (or <span className="font-mono">NOTIFY_NAME_FILE</span>
        ) environment variable in Docker.
      </p>
      <div className="flex flex-col gap-3">
        {channels.map((ch, i) => (
          <ChannelRow
            key={i}
            channel={ch}
            services={services}
            at={(p) => at(`notify.channels.${i}${p ? `.${p}` : ""}`)}
            onChange={(next) => update(i, next)}
            test={test(ch)}
            actions={
              <>
                <Button onClick={() => setChannels(move(channels, i, -1))} disabled={i === 0}>
                  Move up
                </Button>
                <Button
                  onClick={() => setChannels(move(channels, i, 1))}
                  disabled={i === channels.length - 1}
                >
                  Move down
                </Button>
                <Button tone="danger" onClick={() => setChannels(channels.filter((_, j) => j !== i))}>
                  Remove channel
                </Button>
              </>
            }
          />
        ))}
        {implicit.map((ch) => (
          <ImplicitDiscord key={ch.id} channel={ch} alerts={notify.discord} test={test(ch)} />
        ))}
      </div>
      <IssueText issues={at("notify.channels").filter((i) => i.path === "notify.channels")} />
      <Button
        className="mt-3"
        disabled={channels.length >= 20}
        onClick={() => setChannels([...channels, newChannel(channels)])}
      >
        Add channel
      </Button>
    </fieldset>
  );
}

/** The historical Discord channel `channelsOf` adds: read-only, with why it is there and how to replace it. */
function ImplicitDiscord({
  channel,
  alerts,
  test,
}: {
  channel: ChannelConfig;
  alerts: boolean;
  test: ReactNode;
}) {
  return (
    <div className="border border-dashed border-line p-3" role="group" aria-label="Built-in Discord channel">
      <p className="text-sm">
        Discord <span className="font-mono text-xs text-faint">{LEGACY_DISCORD_CHANNEL}</span>{" "}
        <span className="text-xs text-muted">(built in, read-only)</span>
      </p>
      <p className="mt-1 text-xs text-muted">
        Posts to the <span className="font-mono">{LEGACY_DISCORD_SECRET}</span> secret, as before channels
        existed: silent sources always, and services down and back up{" "}
        {alerts ? "because the Alerts switch is on" : "only when the Alerts switch is on (it is off)"}.
        Nothing is sent when that secret is not set. To change it, add a channel that uses{" "}
        <span className="font-mono">{LEGACY_DISCORD_SECRET}</span>: it then replaces this one.
      </p>
      <p className="mt-1 text-xs">Events: {channel.events.map((e) => EVENT_LABEL[e]).join(", ")}</p>
      {test}
    </div>
  );
}

function SecretField({
  label,
  value,
  issues,
  optional,
  hint,
  onChange,
}: {
  label: string;
  value: string | undefined;
  issues: ConfigIssue[];
  optional?: boolean;
  /** One line under the field. */
  hint?: string;
  onChange: (value: string | undefined) => void;
}) {
  const field = (
    <Field
      label={label}
      value={value ?? ""}
      issues={issues}
      className="font-mono"
      autoComplete="off"
      spellCheck={false}
      placeholder={optional ? "none" : "NOTIFY_NAME"}
      pattern="NOTIFY_[A-Z0-9_]+|DISCORD_WEBHOOK_URL"
      onChange={(e) => {
        const v = toSecretName(e.target.value);
        onChange(optional && v === "" ? undefined : v);
      }}
    />
  );
  if (!hint) return field;
  return (
    <div>
      {field}
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

function ChannelRow({
  channel: ch,
  services,
  at,
  onChange,
  test,
  actions,
}: {
  channel: ChannelConfig;
  services: [string, string][];
  at: At;
  onChange: (next: ChannelConfig) => void;
  test: ReactNode;
  actions: ReactNode;
}) {
  const set = (patch: Partial<ChannelConfig>) => onChange({ ...ch, ...patch } as ChannelConfig);
  const known = new Map(services);
  for (const id of ch.services) if (!known.has(id)) known.set(id, id);
  const exact = (p: string) => at(p).filter((i) => i.path.endsWith(`.${p}`));

  return (
    <div className="border border-line p-3" role="group" aria-label={`Channel ${ch.id}`}>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_12rem]">
        <Field
          label="Id"
          value={ch.id}
          issues={at("id")}
          onChange={(e) => onChange(withId(ch, e.target.value))}
        />
        <Field
          label="Name"
          value={ch.name}
          issues={at("name")}
          onChange={(e) => set({ name: e.target.value })}
        />
        <SelectField
          label="Type"
          value={ch.type}
          onChange={(e) => onChange(withChannelType(ch, e.target.value as ChannelType))}
        >
          {CHANNEL_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {ch.type !== "email" && (
          <SecretField
            label={SECRET_LABEL[ch.type]}
            value={ch.secret}
            issues={at("secret")}
            onChange={(v) => set({ secret: v ?? "" })}
          />
        )}
        {ch.type === "webhook" && (
          <>
            <SecretField
              label="Signing key secret (optional)"
              value={ch.signingSecret}
              issues={at("signingSecret")}
              optional
              hint="Leave empty for a plain, unsigned webhook."
              onChange={(v) => set({ signingSecret: v })}
            />
            <SecretField
              label="Authorization header secret (optional)"
              value={ch.authSecret}
              issues={at("authSecret")}
              optional
              hint="Its value is sent as the Authorization header as is, e.g. Bearer <token>."
              onChange={(v) => set({ authSecret: v })}
            />
          </>
        )}
        {ch.type === "ntfy" && (
          <SecretField
            label="Access token secret (optional)"
            value={ch.tokenSecret}
            issues={at("tokenSecret")}
            optional
            onChange={(v) => set({ tokenSecret: v })}
          />
        )}
        {ch.type === "telegram" && (
          <Field
            label="Chat id"
            value={ch.chatId}
            issues={at("chatId")}
            placeholder="-1001234567890 or @channel"
            onChange={(e) => set({ chatId: e.target.value.trim() })}
          />
        )}
        {ch.type === "email" && (
          <>
            <div className="flex flex-col gap-2">
              {ch.to.map((addr, j) => (
                <div key={j} className="flex items-end gap-2">
                  <Field
                    label={`To ${j + 1}`}
                    type="email"
                    className="min-w-0 flex-1"
                    value={addr}
                    issues={at(`to.${j}`)}
                    onChange={(e) => set({ to: ch.to.map((a, k) => (k === j ? e.target.value.trim() : a)) })}
                  />
                  <Button
                    tone="danger"
                    aria-label={`Remove address ${j + 1}`}
                    disabled={ch.to.length === 1}
                    onClick={() => set({ to: ch.to.filter((_, k) => k !== j) })}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <IssueText issues={exact("to")} />
              <Button disabled={ch.to.length >= 10} onClick={() => set({ to: [...ch.to, ""] })}>
                Add address
              </Button>
            </div>
            <Field
              label="From (optional)"
              type="email"
              placeholder="The EMAIL_FROM setting"
              value={ch.from ?? ""}
              issues={at("from")}
              onChange={(e) => set({ from: e.target.value.trim() || undefined })}
            />
          </>
        )}
      </div>
      {ch.type === "webhook" && (
        <p className="mt-1 text-xs text-muted">
          {ch.signingSecret
            ? "Each POST is signed with HMAC-SHA256 over the timestamp and body, keyed by the signing key secret."
            : "Each POST is plain JSON with no X-Uptellis-Signature header; set a signing key secret to sign it."}
        </p>
      )}
      {ch.type === "email" && (
        <p className="mt-1 text-xs text-muted">
          Sent by this instance's email sender; without one, deliveries fail with email_unavailable.
        </p>
      )}

      <p className="mt-3 text-xs text-muted">Events</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {NOTIFY_EVENTS.map((ev) => (
          <li key={ev}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ch.events.includes(ev)}
                onChange={(e) =>
                  set({
                    events: e.target.checked
                      ? NOTIFY_EVENTS.filter((x) => x === ev || ch.events.includes(x))
                      : ch.events.filter((x) => x !== ev),
                  })
                }
              />
              {EVENT_LABEL[ev]}
            </label>
          </li>
        ))}
      </ul>
      <IssueText issues={at("events")} />

      <p className="mt-3 text-xs text-muted">
        Services (down and up only; none checked means every service, source events always pass)
      </p>
      <ul className="mt-1 grid gap-1 sm:grid-cols-2">
        {[...known].map(([id, name]) => (
          <li key={id}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ch.services.includes(id)}
                onChange={(e) =>
                  set({
                    services: e.target.checked ? [...ch.services, id] : ch.services.filter((x) => x !== id),
                  })
                }
              />
              <span className="truncate">{name}</span>
              <span className="truncate font-mono text-xs text-faint">{id}</span>
            </label>
          </li>
        ))}
      </ul>
      <IssueText issues={at("services")} />

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={ch.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Enabled
      </label>
      {test}
      <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

/** A test message to one saved channel: which event, the send button, and what came of it. */
function SendTest({
  channel,
  saved,
  state,
  onSend,
}: {
  channel: ChannelConfig;
  saved: boolean;
  state: TestState | undefined;
  onSend: (kind: TestKind) => void;
}) {
  const [kind, setKind] = useState<TestKind>(channel.events[0] ?? "stale");
  const current = channel.events.includes(kind) ? kind : (channel.events[0] ?? "stale");
  const outcome = state?.outcome;
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <SelectField
        label="Test event"
        value={current}
        onChange={(e) => setKind(e.target.value as TestKind)}
        className="w-44"
      >
        {channel.events.map((ev) => (
          <option key={ev} value={ev}>
            {EVENT_LABEL[ev]}
          </option>
        ))}
      </SelectField>
      <Button disabled={!saved || state?.busy || channel.events.length === 0} onClick={() => onSend(current)}>
        Send test
      </Button>
      <span role="status" className="text-xs">
        {!saved ? (
          <span className="text-muted">Save the config to test this channel as edited.</span>
        ) : state?.busy ? (
          <span className="text-muted">Sending...</span>
        ) : outcome?.sent ? (
          <span className="text-up">Sent (HTTP {outcome.status}).</span>
        ) : outcome ? (
          <span className="text-down">
            Failed: <span className="font-mono">{outcome.error}</span>
            {outcome.status !== null && ` (HTTP ${outcome.status})`}
            {outcome.message && `. ${outcome.message}`}
          </span>
        ) : null}
      </span>
    </div>
  );
}
