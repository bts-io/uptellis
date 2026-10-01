/**
 * The Alerts page: one card per alert channel (where it sends in plain words, which monitors, which events,
 * its last alert, Send test and Edit), the add and edit drawer, the old global switches folded under "More
 * settings", and the recent alerts from the delivery log as sentences. Every change is one save through
 * `useSiteConfig` with a plain note ("Added alert channel Ops Slack").
 */
import { useCallback, useEffect, useState } from "react";
import type { SiteConfig } from "@/shared/config";
import { type ChannelConfig, channelsOf, LEGACY_DISCORD_SECRET } from "@/shared/notify";
import type { ConfigState, Delivery } from "@/shared/schemas/admin";
import type { SiteView } from "@/shared/view";
import { cx } from "../../../kit/cx";
import { knownServices } from "../ConfigEditor";
import { describeFailure, getDeliveries, testChannel } from "../client";
import { EmptyState } from "../EmptyState";
import { AdminIcon } from "../icons";
import { AlertsField } from "../MonitorsEditor";
import { rememberTestAlert } from "../monitors/firstRun";
import { ago, secondsSince, viewServices } from "../monitors/model";
import { PageHeader } from "../PageHeader";
import { sourceLabel } from "../settings/labels";
import { useToast } from "../Toast";
import { Button, Notice } from "../ui";
import { useSiteConfig } from "../useSiteConfig";
import { ChannelForm } from "./ChannelForm";
import { ChannelIcon } from "./ChannelIcon";
import {
  coverage,
  deliveredAt,
  deliverySentence,
  destination,
  draftChannel,
  EVENT_WORD,
  groupDeliveries,
  groupSummary,
  lastByChannel,
  type Subjects,
  TYPE_NAME,
  testKindOf,
  testToast,
} from "./model";

/** A new Discord channel on the built-in channel's webhook and events: saving it replaces the built-in one. */
const asBuiltIn = (draft: ChannelConfig, builtIn: ChannelConfig): ChannelConfig =>
  draft.type === "discord" ? { ...draft, secret: LEGACY_DISCORD_SECRET, events: [...builtIn.events] } : draft;

export interface AlertsPageProps {
  site: string;
  state: ConfigState;
  view: SiteView | null;
  onReload: () => void;
}

type DrawerState =
  | { mode: "closed" }
  | { mode: "add"; start: ChannelConfig }
  | { mode: "edit"; channel: ChannelConfig };

export function AlertsPage({ site, state, view, onReload }: AlertsPageProps) {
  const cfg = useSiteConfig({ site, state, onReload });
  const toast = useToast();
  const config = cfg.config;
  const channels = config.notify.channels;
  const builtIn = channelsOf(config.notify).filter((c) => !channels.includes(c));
  const services = knownServices(
    config,
    viewServices(view).map((s) => ({ id: s.id, name: s.name })),
  );
  const subjects: Subjects = {
    services,
    sources: new Map(
      [...config.sources.map((s) => s.id), ...(view?.freshness.perSource.map((s) => s.id) ?? [])].map(
        (id) => [id, sourceLabel(id)],
      ),
    ),
  };
  const channelNames = new Map(channelsOf(config.notify).map((c) => [c.id, c.name]));

  const [drawer, setDrawer] = useState<DrawerState>({ mode: "closed" });
  const [testing, setTesting] = useState<ReadonlySet<string>>(new Set());
  const log = useDeliveries(site, cfg.version);

  const openAdd = (start?: ChannelConfig) =>
    setDrawer({ mode: "add", start: start ?? draftChannel("discord", "Team Discord", channels) });

  const save = async (ch: ChannelConfig): Promise<string | null> => {
    const editing = drawer.mode === "edit" ? drawer.channel : null;
    const note = editing ? `Updated alert channel ${ch.name}` : `Added alert channel ${ch.name}`;
    const change = (c: SiteConfig): SiteConfig => ({
      ...c,
      notify: {
        ...c.notify,
        channels: editing
          ? c.notify.channels.map((x) => (x.id === editing.id ? ch : x))
          : [...c.notify.channels, ch],
      },
    });
    const out = await cfg.save(change, note);
    if (!out.ok) return out.message;
    toast(note);
    setDrawer({ mode: "closed" });
    return null;
  };

  const remove = async (ch: ChannelConfig): Promise<string | null> => {
    const note = `Deleted alert channel ${ch.name}`;
    const out = await cfg.save(
      (c) => ({ ...c, notify: { ...c.notify, channels: c.notify.channels.filter((x) => x.id !== ch.id) } }),
      note,
    );
    if (!out.ok) return out.message;
    toast(note);
    return null;
  };

  const sendTest = async (ch: ChannelConfig) => {
    setTesting((t) => new Set(t).add(ch.id));
    const outcome = await testChannel(site, ch.id, testKindOf(ch));
    if (outcome.sent) rememberTestAlert(site);
    setTesting((t) => {
      const next = new Set(t);
      next.delete(ch.id);
      return next;
    });
    const t = testToast(ch.name, outcome);
    toast(t.message, t.tone);
  };

  const setDiscordSwitch = async (notify: SiteConfig["notify"]) => {
    const note = notify.discord
      ? "Turned on built-in Discord alerts for down and back up"
      : "Turned off built-in Discord alerts for down and back up";
    const out = await cfg.save((c) => ({ ...c, notify: { ...c.notify, discord: notify.discord } }), note);
    toast(out.ok ? note : out.message, out.ok ? "ok" : "error");
  };

  const last = lastByChannel(log.deliveries ?? []);
  const now = new Date().toISOString();
  const addButton = (
    <Button tone="primary" onClick={() => openAdd()}>
      <AdminIcon name="plus" />
      Add channel
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Where we tell you when something goes down or comes back."
        actions={addButton}
      />
      <div className="flex flex-col gap-8">
        {channels.length === 0 ? (
          <EmptyState
            title="No alert channels yet"
            text="Add one and we tell you by email, chat, text or webhook when a monitor goes down or comes back."
            action={addButton}
          />
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Alert channels">
            {channels.map((ch) => (
              <li key={ch.id}>
                <ChannelCard
                  channel={ch}
                  services={services}
                  last={last.get(ch.id)}
                  subjects={subjects}
                  now={now}
                  testing={testing.has(ch.id)}
                  onTest={() => void sendTest(ch)}
                  onEdit={() => setDrawer({ mode: "edit", channel: ch })}
                />
              </li>
            ))}
          </ul>
        )}

        <details className="group border border-line bg-panel">
          <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-ink">
            <span>
              More settings{" "}
              <span className="font-normal text-muted">
                the built-in Discord channel from before channels
              </span>
            </span>
            <AdminIcon name="chevron" className="transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
            <AlertsField notify={config.notify} onChange={(n) => void setDiscordSwitch(n)} />
            {builtIn.map((ch) => (
              <div key={ch.id} className="flex flex-col gap-2 border border-dashed border-line p-3">
                <p className="text-sm text-ink">
                  Built-in Discord channel{" "}
                  <span className="text-muted">
                    posts to the Discord webhook set on the server, when it is set. Sends:{" "}
                    {ch.events.map((e) => EVENT_WORD[e]).join(", ")}.
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={testing.has(ch.id)} onClick={() => void sendTest(ch)}>
                    <AdminIcon name="send" />
                    Send test<span className="sr-only"> to the built-in Discord channel</span>
                  </Button>
                  <Button
                    onClick={() => openAdd(asBuiltIn(draftChannel("discord", "Discord", channels), ch))}
                  >
                    <AdminIcon name="edit" />
                    Make it a regular channel
                  </Button>
                </div>
              </div>
            ))}
            {builtIn.length === 0 && (
              <p className="text-xs text-muted">
                One of your channels took over the built-in Discord channel, so the built-in one is off and
                the switch above has no effect.
              </p>
            )}
          </div>
        </details>

        <RecentAlerts log={log} channelNames={channelNames} subjects={subjects} now={now} />
      </div>

      <ChannelForm
        open={drawer.mode !== "closed"}
        onClose={() => setDrawer({ mode: "closed" })}
        config={config}
        editing={drawer.mode === "edit" ? drawer.channel : null}
        start={drawer.mode === "add" ? drawer.start : draftChannel("discord", "Team Discord", channels)}
        services={services}
        saving={cfg.saving}
        onSave={save}
        onDelete={async (ch) => {
          const out = await remove(ch);
          if (!out) setDrawer({ mode: "closed" });
          return out;
        }}
      />
    </>
  );
}

function ChannelCard({
  channel: ch,
  services,
  last,
  subjects,
  now,
  testing,
  onTest,
  onEdit,
}: {
  channel: ChannelConfig;
  services: ReadonlyMap<string, string>;
  last: Delivery | undefined;
  subjects: Subjects;
  now: string;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
}) {
  const headingId = `channel-${ch.id}`;
  return (
    <article
      aria-labelledby={headingId}
      data-channel
      className={cx(
        "grid gap-3 border border-line bg-panel p-4 sm:grid-cols-[auto_1fr_auto] sm:items-start",
        !ch.enabled && "opacity-75",
      )}
    >
      <span className="flex size-10 items-center justify-center border border-line text-accent">
        <ChannelIcon type={ch.type} />
      </span>
      <div className="min-w-0">
        <h2 id={headingId} className="text-[15px] font-semibold text-ink">
          {ch.name}
          {!ch.enabled && <span className="ml-2 text-xs font-normal text-muted">Off</span>}
        </h2>
        <p className="mt-0.5 text-sm text-muted" data-destination>
          {TYPE_NAME[ch.type]}. {destination(ch)}. {coverage(ch, services)}.
        </p>
        <ul aria-label="Sends when" className="mt-2 flex flex-wrap gap-1.5">
          {ch.events.map((e) => (
            <li
              key={e}
              className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-ink"
            >
              <AdminIcon name="check" size={12} />
              {EVENT_WORD[e]}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          {last
            ? `Last alert ${ago(secondsSince(deliveredAt(last), now))}: ${deliverySentence(last, subjects)}${
                last.status === "failed" ? " (not delivered)" : ""
              }.`
            : "No alerts sent here yet."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        <Button onClick={onTest} disabled={testing || ch.events.length === 0}>
          <AdminIcon name="send" />
          {testing ? "Sending..." : "Send test"}
          <span className="sr-only"> to {ch.name}</span>
        </Button>
        <Button onClick={onEdit}>
          <AdminIcon name="edit" />
          Edit<span className="sr-only"> {ch.name}</span>
        </Button>
      </div>
    </article>
  );
}

interface DeliveryLogState {
  deliveries: Delivery[] | null;
  error: string | null;
  busy: boolean;
  load: () => Promise<void>;
}

/** The delivery log, loaded in the browser after the page (and again after each save). */
function useDeliveries(site: string, version: number): DeliveryLogState {
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
  // A new saved version loads the log again.
  useEffect(() => {
    void load();
  }, [load, version]);
  return { deliveries, error, busy, load };
}

function RecentAlerts({
  log,
  channelNames,
  subjects,
  now,
}: {
  log: DeliveryLogState;
  channelNames: ReadonlyMap<string, string>;
  subjects: Subjects;
  now: string;
}) {
  const groups = groupDeliveries(log.deliveries ?? [], channelNames, subjects);
  return (
    <section aria-labelledby="recent-alerts">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="recent-alerts" className="text-lg font-semibold text-ink">
            Recent alerts
          </h2>
          <p className="text-sm text-muted">
            The latest alerts and where they went. Ones that did not get through are tried again for an hour.
          </p>
        </div>
        <Button onClick={() => void log.load()} disabled={log.busy}>
          Refresh
        </Button>
      </div>
      {log.error && (
        <Notice tone="error" className="mb-3">
          Could not load recent alerts: {log.error}
        </Notice>
      )}
      {log.deliveries === null ? (
        !log.error && <p className="text-sm text-muted">Loading...</p>
      ) : groups.length === 0 ? (
        <p className="border border-line bg-panel p-4 text-sm text-muted">No alerts sent yet.</p>
      ) : (
        <ul className="flex flex-col border border-line bg-panel" aria-label="Recent alerts">
          {groups.map((g) => (
            <li
              key={g.key}
              data-alert
              className="flex items-start gap-3 border-t border-hair px-4 py-3 first:border-t-0"
            >
              <span className={cx("mt-0.5", g.opened ? "text-down" : "text-up")}>
                <AdminIcon name={g.opened ? "down" : "up"} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{g.sentence}</p>
                <p className={cx("text-xs", g.failed.length ? "text-down" : "text-muted")}>
                  {groupSummary(g)}
                </p>
              </div>
              <span className="text-xs whitespace-nowrap text-muted">{ago(secondsSince(g.at, now))}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
