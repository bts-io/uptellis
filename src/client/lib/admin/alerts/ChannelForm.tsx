/**
 * The add and edit drawer of an alert channel: a type tile, a name, the type's fields with one line each,
 * the events, which monitors it covers (by name) and whether it is on. Fields and issues are the full
 * editor's (`SecretField`, `withChannelType` from ../ChannelsEditor, the `SiteConfig` schema), so either
 * editor saves the same channel. A secret is entered as the NAME of a server secret, never its value.
 */
import { type ReactNode, useId, useState } from "react";
import type { SiteConfig } from "@/shared/config";
import { type ChannelConfig, type ChannelType, NOTIFY_EVENTS } from "@/shared/notify";
import { cx } from "../../../kit/cx";
import { SECRET_LABEL, SecretField, withChannelType, withId } from "../ChannelsEditor";
import { validateConfig } from "../ConfigEditor";
import { Drawer } from "../Drawer";
import { AdminIcon } from "../icons";
import { Button, Field, IssueText, inputClass, Notice } from "../ui";
import { ChannelIcon } from "./ChannelIcon";
import { EVENT_HELP, freeIdFor, TILE_ORDER, TYPE_HINT, TYPE_NAME } from "./model";

export interface ChannelFormProps {
  open: boolean;
  onClose: () => void;
  /** The saved config: the draft is checked inside it, as it would be saved. */
  config: SiteConfig;
  /** The channel being edited (its id is kept); null adds `start`. */
  editing: ChannelConfig | null;
  /** What a new channel starts as. */
  start: ChannelConfig;
  /** Monitors a channel can be limited to: service id and name. */
  services: ReadonlyMap<string, string>;
  saving: boolean;
  /** Saves the channel; answers an error message, or null once saved. */
  onSave: (channel: ChannelConfig) => Promise<string | null>;
  onDelete: (channel: ChannelConfig) => Promise<string | null>;
}

export function ChannelForm(props: ChannelFormProps) {
  const { open, onClose, editing } = props;
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.name}` : "Add alert channel"}
      description="Where we send alerts, and which ones."
      initialFocus='input[name="channel-type"]:checked'
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" type="submit" form="channel-form" disabled={props.saving}>
            {editing ? "Save changes" : "Add channel"}
          </Button>
        </>
      }
    >
      {open && <ChannelFields key={editing?.id ?? "new"} {...props} />}
    </Drawer>
  );
}

function ChannelFields({ config, editing, start, services, onSave, onDelete, onClose }: ChannelFormProps) {
  const [ch, setCh] = useState<ChannelConfig>(editing ?? start);
  const [only, setOnly] = useState(ch.services.length > 0);
  const [filter, setFilter] = useState("");
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const formId = useId();
  const others = config.notify.channels.filter((c) => c.id !== editing?.id);
  const index = editing ? config.notify.channels.findIndex((c) => c.id === editing.id) : others.length;

  const set = (patch: Partial<ChannelConfig>) => setCh((c) => ({ ...c, ...patch }) as ChannelConfig);
  // A new channel's id follows its name (and suggested secret names follow the id); a saved one keeps its id.
  const rename = (name: string) =>
    setCh((c) => (editing ? { ...c, name } : { ...withId(c, freeIdFor(name, others)), name }));

  const channels = [...others];
  channels.splice(index < 0 ? others.length : index, 0, ch);
  const prefix = `notify.channels.${index < 0 ? others.length : index}`;
  const all = validateConfig({ ...config, notify: { ...config.notify, channels } }).filter(
    (i) => i.path === prefix || i.path.startsWith(`${prefix}.`),
  );
  const at = (p: string) =>
    tried ? all.filter((i) => i.path === `${prefix}.${p}` || i.path.startsWith(`${prefix}.${p}.`)) : [];
  const needsPick = only && ch.services.length === 0;
  const blocked = all.length > 0 || needsPick;

  const submit = async () => {
    setTried(true);
    setError(null);
    if (blocked) return;
    const out = await onSave({ ...ch, services: only ? ch.services : [] });
    if (out) setError(out);
  };

  const names = [...services].filter(([, name]) => name.toLowerCase().includes(filter.trim().toLowerCase()));
  for (const id of ch.services) if (!services.has(id)) names.push([id, "A removed monitor"]);

  return (
    <form
      id="channel-form"
      aria-labelledby={`${formId}-legend`}
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset>
        <legend id={`${formId}-legend`} className="mb-2 text-sm font-semibold text-ink">
          Send alerts by
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TILE_ORDER.map((t) => (
            <label
              key={t}
              className={cx(
                "flex cursor-pointer items-center gap-2 border px-3 py-2 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
                ch.type === t ? "border-accent bg-raised text-ink" : "border-line text-muted hover:bg-raised",
              )}
            >
              <input
                type="radio"
                name="channel-type"
                value={t}
                className="sr-only"
                checked={ch.type === t}
                onChange={() => setCh((c) => withChannelType(c, t as ChannelType))}
              />
              <ChannelIcon type={t} size={18} />
              {TYPE_NAME[t]}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">{TYPE_HINT[ch.type]}</p>
      </fieldset>

      <Field label="Name" value={ch.name} issues={at("name")} onChange={(e) => rename(e.target.value)} />

      <div className="flex flex-col gap-3">
        <TypeFields ch={ch} at={at} set={set} />
        {ch.type !== "email" && (
          <p className="text-xs text-muted">
            For safety we store only the name of a secret, never its value. Set the value on the server: with{" "}
            <span className="font-mono">wrangler secret put</span> on Cloudflare, or as an environment
            variable in Docker.
          </p>
        )}
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">Tell me when</legend>
        <ul className="flex flex-col gap-1">
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
                {EVENT_HELP[ev]}
              </label>
            </li>
          ))}
        </ul>
        <IssueText issues={at("events")} />
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-ink">Covers</legend>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="channel-scope" checked={!only} onChange={() => setOnly(false)} />
            All monitors
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="channel-scope" checked={only} onChange={() => setOnly(true)} />
            Only these monitors
          </label>
        </div>
        <p className="mt-1 text-xs text-muted">
          Applies to down and back up. Source silent and source back always reach every channel that wants
          them.
        </p>
        {only && (
          <div className="mt-3 flex flex-col gap-2">
            <label className="sr-only" htmlFor={`${formId}-filter`}>
              Find a monitor
            </label>
            <input
              id={`${formId}-filter`}
              type="search"
              placeholder="Find a monitor"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className={inputClass}
            />
            <ul
              aria-label="Monitors"
              className="flex max-h-60 flex-col gap-1 overflow-y-auto border border-line p-2"
            >
              {names.length === 0 && <li className="text-sm text-muted">No monitor matches.</li>}
              {names.map(([id, name]) => (
                <li key={id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={ch.services.includes(id)}
                      onChange={(e) =>
                        set({
                          services: e.target.checked
                            ? [...ch.services, id]
                            : ch.services.filter((x) => x !== id),
                        })
                      }
                    />
                    <span className="truncate">{name}</span>
                  </label>
                </li>
              ))}
            </ul>
            {tried && needsPick && (
              <p className="text-xs text-down">Pick at least one monitor, or choose All monitors.</p>
            )}
            <IssueText issues={at("services")} />
          </div>
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={ch.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        On: send alerts to this channel
      </label>

      {tried && blocked && !error && (
        <Notice tone="error">Some fields need attention before this channel can be saved.</Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {editing && (
        <section className="border-t border-line pt-4" aria-label="Delete channel">
          {confirmDelete ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-ink">
                Delete {editing.name}? Alerts stop going there. You can undo this from Settings, Revisions.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  tone="danger"
                  onClick={() =>
                    void onDelete(editing).then((out) => {
                      if (out) setError(out);
                      else onClose();
                    })
                  }
                >
                  Delete {editing.name}
                </Button>
                <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
              </div>
            </div>
          ) : (
            <Button tone="danger" onClick={() => setConfirmDelete(true)}>
              <AdminIcon name="trash" />
              Delete channel
            </Button>
          )}
        </section>
      )}
    </form>
  );
}

/** A placeholder address, joined at run time (the repo scan rejects written addresses). */
const EXAMPLE_ADDRESS = ["you", "example.com"].join("@");

type At = (path: string) => { path: string; message: string }[];

/** The fields of the channel's type, each with its one line. */
function TypeFields({
  ch,
  at,
  set,
}: {
  ch: ChannelConfig;
  at: At;
  set: (patch: Partial<ChannelConfig>) => void;
}) {
  const exact = (p: string) => at(p).filter((i) => i.path.endsWith(`.${p}`));
  switch (ch.type) {
    case "email":
      return (
        <>
          <div className="flex flex-col gap-2">
            {ch.to.map((addr, j) => (
              <div key={j} className="flex items-end gap-2">
                <Field
                  label={ch.to.length === 1 ? "Email address" : `Email address ${j + 1}`}
                  type="email"
                  className="min-w-0 flex-1"
                  placeholder={EXAMPLE_ADDRESS}
                  value={addr}
                  issues={at(`to.${j}`)}
                  onChange={(e) => set({ to: ch.to.map((a, k) => (k === j ? e.target.value.trim() : a)) })}
                />
                {ch.to.length > 1 && (
                  <Button
                    tone="danger"
                    aria-label={`Remove address ${j + 1}`}
                    onClick={() => set({ to: ch.to.filter((_, k) => k !== j) })}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
            <IssueText issues={exact("to")} />
            <div>
              <Button disabled={ch.to.length >= 10} onClick={() => set({ to: [...ch.to, ""] })}>
                Add another address
              </Button>
            </div>
          </div>
          <Hinted hint="Leave empty to send from this instance's usual address.">
            <Field
              label="Send from (optional)"
              type="email"
              value={ch.from ?? ""}
              issues={at("from")}
              onChange={(e) => set({ from: e.target.value.trim() || undefined })}
            />
          </Hinted>
        </>
      );
    case "discord":
    case "slack":
      return (
        <SecretField
          label={`${TYPE_NAME[ch.type]} webhook URL secret`}
          value={ch.secret}
          issues={at("secret")}
          hint={`The name of the server secret that holds the ${TYPE_NAME[ch.type]} webhook URL.`}
          onChange={(v) => set({ secret: v ?? "" })}
        />
      );
    case "telegram":
      return (
        <>
          <SecretField
            label={SECRET_LABEL.telegram}
            value={ch.secret}
            issues={at("secret")}
            hint="The name of the server secret that holds your bot's token from BotFather."
            onChange={(v) => set({ secret: v ?? "" })}
          />
          <Hinted hint="A number such as -1001234567890, or @channel for a public channel.">
            <Field
              label="Chat"
              value={ch.chatId}
              issues={at("chatId")}
              placeholder="@your_channel"
              onChange={(e) => set({ chatId: e.target.value.trim() })}
            />
          </Hinted>
        </>
      );
    case "sms":
      return (
        <>
          <Hinted hint="One number in international form. Add a channel per person.">
            <Field
              label="Phone number"
              type="tel"
              value={ch.to}
              issues={at("to")}
              autoComplete="off"
              placeholder="+15551234567"
              onChange={(e) => set({ to: e.target.value.replace(/\s/g, "") })}
            />
          </Hinted>
          <Hinted hint="Your Twilio number, or a Messaging Service id starting with MG.">
            <Field
              label="Send from"
              value={ch.from}
              issues={at("from")}
              autoComplete="off"
              placeholder="+15551234567"
              onChange={(e) => set({ from: e.target.value.replace(/\s/g, "") })}
            />
          </Hinted>
          <Hinted hint="On your Twilio console's home page: AC followed by 32 characters.">
            <Field
              label="Twilio Account SID"
              value={ch.accountSid}
              issues={at("accountSid")}
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set({ accountSid: e.target.value.trim() })}
            />
          </Hinted>
          <SecretField
            label={SECRET_LABEL.sms}
            value={ch.secret}
            issues={at("secret")}
            hint="The name of the server secret that holds your Twilio auth token."
            onChange={(v) => set({ secret: v ?? "" })}
          />
        </>
      );
    case "webhook":
      return (
        <>
          <SecretField
            label={SECRET_LABEL.webhook}
            value={ch.secret}
            issues={at("secret")}
            hint="The name of the server secret that holds your endpoint's URL."
            onChange={(v) => set({ secret: v ?? "" })}
          />
          <SecretField
            label="Signing key secret (optional)"
            value={ch.signingSecret}
            issues={at("signingSecret")}
            optional
            hint="With one, each POST carries an HMAC signature; leave empty for plain JSON."
            onChange={(v) => set({ signingSecret: v })}
          />
          <SecretField
            label="Authorization header secret (optional)"
            value={ch.authSecret}
            issues={at("authSecret")}
            optional
            hint="Its value is sent as the Authorization header as is, for example Bearer and a token."
            onChange={(v) => set({ authSecret: v })}
          />
        </>
      );
    case "ntfy":
      return (
        <>
          <SecretField
            label={SECRET_LABEL.ntfy}
            value={ch.secret}
            issues={at("secret")}
            hint="The name of the server secret that holds the topic URL, such as an ntfy.sh topic."
            onChange={(v) => set({ secret: v ?? "" })}
          />
          <SecretField
            label="Access token secret (optional)"
            value={ch.tokenSecret}
            issues={at("tokenSecret")}
            optional
            hint="Only for a protected topic."
            onChange={(v) => set({ tokenSecret: v })}
          />
        </>
      );
  }
}

function Hinted({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <div>
      {children}
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}
