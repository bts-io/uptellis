/**
 * The Discord cards Uptellis posts to its webhook: a source went silent (its `stale` incident opened) and
 * it is back (the incident resolved); a service is down (its `down` incident opened) and it is back up (the
 * incident resolved). Pure: everything the card says comes in through the input.
 *
 * Layout: Components V2 (flags 32768), one container with an accent colour, a `###` heading with an emoji,
 * `**Key:** value` fields, a small grey footer with a Discord timestamp, a divider and a row of link buttons.
 * Nothing may ping (`allowed_mentions` is empty).
 * The text is ours (source ids match `SourceId`, hosts come from them); `cardIsSafe` still checks it for
 * addresses, emails and tokens before anything is sent.
 */
import {
  containsForbiddenLiteral,
  FRESHNESS_FACTORS,
  type Incident,
  type Service,
  type Source,
  sourceFreshness,
} from "@/shared/model";

export const IS_COMPONENTS_V2 = 1 << 15;

/** The card accents: dark red for silent, red for down, green for back. */
export const ACCENT = { stale: 0x7f1d1d, down: 0xdc2626, recovered: 0x22c55e } as const;

/** Webhook display name. */
export const USERNAME = "Uptellis";

type TextDisplay = { type: 10; content: string };
type Separator = { type: 14; divider: boolean; spacing: 1 | 2 };
type LinkButton = { type: 2; style: 5; label: string; url: string };
type ActionRow = { type: 1; components: LinkButton[] };

export interface DiscordCard {
  username: string;
  flags: typeof IS_COMPONENTS_V2;
  allowed_mentions: { parse: [] };
  components: [{ type: 17; accent_color: number; components: (TextDisplay | Separator | ActionRow)[] }];
}

export interface StaleCardInput {
  site: string;
  /** The `stale` incident that opened. */
  incident: Incident;
  /** Every source of the site as stored now, the silent one included. */
  sources: readonly Source[];
  /** `https://<first site hostname>/`, or null when the site has none. */
  pageUrl: string | null;
  now: number;
  /** A test card from the admin panel: labelled as such, nothing is wrong. */
  test?: boolean;
}

export interface RecoveredCardInput {
  site: string;
  /** The `stale` incident that resolved (`endedAt` set). */
  incident: Incident;
  /** The source as stored now. */
  source: Source;
  /** Heartbeats stored with a `ts` inside the silent window (Kuma sources), else null. */
  backfilled: number | null;
  pageUrl: string | null;
  now: number;
  test?: boolean;
}

/** The service of a `down` incident as the cards show it. */
export type CardService = Pick<Service, "id" | "source" | "targetDisplay"> & {
  /** Display name (the config's `displayNames` applied). */
  name: string;
};

export interface DownCardInput {
  site: string;
  /** The `down` incident that opened. */
  incident: Incident;
  service: CardService;
  /** The message of the check that went down (e.g. `HTTP 503`, `timeout`), or null. */
  reason: string | null;
  pageUrl: string | null;
  now: number;
  test?: boolean;
}

export interface UpCardInput {
  site: string;
  /** The `down` incident that resolved (`endedAt` set). */
  incident: Incident;
  service: CardService;
  pageUrl: string | null;
  now: number;
  test?: boolean;
}

const MIN_MS = 60_000;

/** The machine a source id's suffix names: `kuma:watch-1` runs on `watch-1`. */
export const hostOf = (sourceId: string) => sourceId.slice(sourceId.indexOf(":") + 1);

/** Who produces a source's reports, in words. */
export function producerOf(sourceId: string): string {
  const kind = sourceId.slice(0, sourceId.indexOf(":"));
  if (kind === "kuma") return `Kuma collector on ${hostOf(sourceId)}`;
  if (kind === "facts") return `facts pusher on ${hostOf(sourceId)}`;
  if (sourceId === "probe:cf") return "Cloudflare probes";
  if (sourceId === "probe:server") return "the server's own probes";
  if (kind === "probe") return `agent ${hostOf(sourceId)}`;
  return `signed webhooks from ${hostOf(sourceId)}`;
}

/** `2026-09-27 10:15 UTC`. */
export const utc = (t: number) => `${new Date(t).toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** `45 s` under two minutes, then `15 min`, `2 h 5 min`, `3 d 4 h`. */
export function interval(seconds: number): string {
  if (seconds < 120) return `${seconds} s`;
  return duration(seconds * 1000);
}

/** A span in whole minutes: `under 1 min`, `12 min`, `2 h 5 min`, `3 d 4 h`. */
export function duration(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / MIN_MS);
  if (min < 1) return "under 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  return h % 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${Math.floor(h / 24)} d`;
}

/** When the source last reported before a `stale` incident: its start less the stale threshold. */
export function silentSince(incident: Incident, source: Pick<Source, "expectedIntervalS">): number {
  return Date.parse(incident.startedAt) - FRESHNESS_FACTORS.stale * source.expectedIntervalS * 1000;
}

export function staleCard(input: StaleCardInput): DiscordCard {
  const id = input.incident.sourceId ?? "";
  const source = input.sources.find((s) => s.id === id);
  const last = source?.lastSeenAt ? Date.parse(source.lastSeenAt) : null;
  const others = input.sources.filter((s) => s.id !== id && isFresh(s, input.now)).map((s) => s.id);
  return card({
    accent: ACCENT.stale,
    heading: `🚨 ${title(input.test)}Uptellis: ${id} went silent`,
    description: input.test
      ? "Test card from the admin panel, built from the current state: nothing is silent."
      : "The status page shows its data as stale until it reports again.",
    fields: [
      ["Producer", producerOf(id)],
      ["Last report", last === null ? "never" : `${utc(last)} (${duration(input.now - last)} ago)`],
      ["Expected interval", source ? `every ${interval(source.expectedIntervalS)}` : "unknown"],
      ["Still reporting", others.length ? others.join(", ") : "no other source"],
    ],
    site: input.site,
    now: input.now,
    pageUrl: input.pageUrl,
  });
}

export function recoveredCard(input: RecoveredCardInput): DiscordCard {
  const { incident, source } = input;
  const from = silentSince(incident, source);
  const back = Date.parse(incident.endedAt ?? incident.startedAt);
  return card({
    accent: ACCENT.recovered,
    heading: `✅ ${title(input.test)}Uptellis: ${source.id} is back`,
    description: input.test
      ? "Test card from the admin panel, built from the current state: nothing changed."
      : "Reporting again; the status page is current.",
    fields: [
      ["Producer", producerOf(source.id)],
      ["Silent for", duration(back - from)],
      ["First report again", utc(back)],
      ...(input.backfilled === null
        ? []
        : ([["Beats backfilled for the gap", String(input.backfilled)]] as [string, string][])),
    ],
    site: input.site,
    now: input.now,
    pageUrl: input.pageUrl,
  });
}

export function downCard(input: DownCardInput): DiscordCard {
  const { incident, service } = input;
  const since = Date.parse(incident.startedAt);
  return card({
    accent: ACCENT.down,
    heading: `🔴 ${title(input.test)}Uptellis: ${service.name} is down`,
    description: input.test
      ? "Test card from the admin panel, built from the current state: nothing is down."
      : "Confirmed down; an incident is open on the status page.",
    fields: [
      ["Service", service.id],
      ...(service.targetDisplay ? ([["Target", service.targetDisplay]] as [string, string][]) : []),
      ["Checked by", producerOf(service.source)],
      ["Down since", `${utc(since)} (${duration(input.now - since)} ago)`],
      ...(input.reason ? ([["Reason", input.reason]] as [string, string][]) : []),
    ],
    site: input.site,
    now: input.now,
    pageUrl: input.pageUrl,
  });
}

export function upCard(input: UpCardInput): DiscordCard {
  const { incident, service } = input;
  const from = Date.parse(incident.startedAt);
  const back = Date.parse(incident.endedAt ?? incident.startedAt);
  return card({
    accent: ACCENT.recovered,
    heading: `✅ ${title(input.test)}Uptellis: ${service.name} is back up`,
    description: input.test
      ? "Test card from the admin panel, built from the current state: nothing changed."
      : "Up again; the incident is resolved.",
    fields: [
      ["Service", service.id],
      ["Down for", duration(back - from)],
      ["Down since", utc(from)],
      ["Back up", utc(back)],
    ],
    site: input.site,
    now: input.now,
    pageUrl: input.pageUrl,
  });
}

/** False when any text or link of the card carries an address, an email or a token. */
export function cardIsSafe(card: DiscordCard): boolean {
  const texts: string[] = [card.username];
  for (const c of card.components[0].components) {
    if (c.type === 10) texts.push(c.content);
    if (c.type === 1) for (const b of c.components) texts.push(b.label, b.url);
  }
  return !texts.some(containsForbiddenLiteral);
}

const title = (test?: boolean) => (test ? "TEST: " : "");

const isFresh = (source: Source, now: number) => sourceFreshness(source, now) === "fresh";

function card(c: {
  accent: number;
  heading: string;
  description: string;
  fields: [string, string][];
  site: string;
  now: number;
  pageUrl: string | null;
}): DiscordCard {
  const head = [`### ${c.heading}`, c.description, "", ...c.fields.map(([k, v]) => `**${k}:** ${v}`)];
  const parts: DiscordCard["components"][0]["components"] = [
    { type: 10, content: head.join("\n") },
    { type: 10, content: `-# Uptellis · ${c.site} · <t:${Math.floor(c.now / 1000)}:f>` },
  ];
  if (c.pageUrl) {
    parts.push(
      { type: 14, divider: true, spacing: 1 },
      { type: 1, components: [{ type: 2, style: 5, label: "Status page", url: c.pageUrl }] },
    );
  }
  return {
    username: USERNAME,
    flags: IS_COMPONENTS_V2,
    allowed_mentions: { parse: [] },
    components: [{ type: 17, accent_color: c.accent, components: parts }],
  };
}
