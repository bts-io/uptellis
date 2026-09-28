/**
 * The one `AlertMessage` per incident transition, built from the same data the Discord cards have always
 * used: a source went silent (`stale`) and is back (`recovered`), a service is down (`down`) and back up
 * (`up`). Pure: everything comes in through the input; the dispatcher (./index.ts) reads it from the
 * database. The source cards' extra facts (last report, expected interval, still reporting, beats
 * backfilled) travel as `details`. The result is not validated here: the dispatcher parses it with
 * `AlertMessage` before any channel sees it.
 */
import { type Incident, type Service, type Source, sourceFreshness } from "@/shared/model";
import { type AlertMessage, NotifyEvent, SEVERITY_OF } from "@/shared/notify";
import { toIso } from "@/worker/db/util";
import { duration, interval, producerOf, silentSince, utc } from "./format";

interface AlertBase {
  /** The site slug. */
  site: string;
  /** The site's display name; the slug when absent. */
  siteName?: string;
  /** `https://<first site hostname>/`, or null when the site has none. */
  pageUrl: string | null;
  /** When the message is built (its `sentAt`, and what ages are measured against). */
  now: number;
  /** A test message from the admin panel: labelled as such, nothing is wrong. */
  test?: boolean;
}

export interface StaleCardInput extends AlertBase {
  /** The `stale` incident that opened. */
  incident: Incident;
  /** Every source of the site as stored now, the silent one included. */
  sources: readonly Source[];
}

export interface RecoveredCardInput extends AlertBase {
  /** The `stale` incident that resolved (`endedAt` set). */
  incident: Incident;
  /** The source as stored now. */
  source: Source;
  /** Heartbeats stored with a `ts` inside the silent window (Kuma sources), else null. */
  backfilled: number | null;
}

/** The service of a `down` incident as the messages show it. */
export type CardService = Pick<Service, "id" | "source" | "targetDisplay"> & {
  /** Display name (the config's `displayNames` applied). */
  name: string;
};

export interface DownCardInput extends AlertBase {
  /** The `down` incident that opened. */
  incident: Incident;
  service: CardService;
  /** The message of the check that went down (e.g. `HTTP 503`, `timeout`), or null. */
  reason: string | null;
}

export interface UpCardInput extends AlertBase {
  /** The `down` incident that resolved (`endedAt` set). */
  incident: Incident;
  service: CardService;
}

function base(input: AlertBase, event: NotifyEvent, incident: Incident) {
  return {
    v: 1 as const,
    event: NotifyEvent.parse(event),
    severity: SEVERITY_OF[event],
    incidentId: incident.id,
    site: { slug: input.site, name: (input.siteName ?? input.site).slice(0, 80) },
    pageUrl: input.pageUrl,
    test: input.test === true,
    sentAt: toIso(input.now),
  };
}

const seconds = (ms: number) => Math.max(0, Math.floor(ms / 1000));

export function staleMessage(input: StaleCardInput): AlertMessage {
  const id = input.incident.sourceId ?? "";
  const source = input.sources.find((s) => s.id === id);
  const last = source?.lastSeenAt ? Date.parse(source.lastSeenAt) : null;
  const others = input.sources
    .filter((s) => s.id !== id && sourceFreshness(s, input.now) === "fresh")
    .map((s) => s.id);
  return {
    ...base(input, "stale", input.incident),
    subject: { kind: "source", id, reporter: producerOf(id) },
    title: `${id} went silent`,
    reason: null,
    startedAt: input.incident.startedAt,
    endedAt: null,
    durationS: null,
    details: [
      {
        label: "Last report",
        value: last === null ? "never" : `${utc(last)} (${duration(input.now - last)} ago)`,
      },
      {
        label: "Expected interval",
        value: source ? `every ${interval(source.expectedIntervalS)}` : "unknown",
      },
      { label: "Still reporting", value: others.length ? others.join(", ") : "no other source" },
    ],
  };
}

export function recoveredMessage(input: RecoveredCardInput): AlertMessage {
  const { incident, source } = input;
  const from = silentSince(incident, source);
  const back = Date.parse(incident.endedAt ?? incident.startedAt);
  return {
    ...base(input, "recovered", incident),
    subject: { kind: "source", id: source.id, reporter: producerOf(source.id) },
    title: `${source.id} is back`,
    reason: null,
    startedAt: incident.startedAt,
    endedAt: toIso(back),
    durationS: seconds(back - from),
    details:
      input.backfilled === null
        ? []
        : [{ label: "Beats backfilled for the gap", value: String(input.backfilled) }],
  };
}

const subjectOf = (service: CardService) => ({
  kind: "service" as const,
  id: service.id,
  name: service.name,
  target: service.targetDisplay ?? null,
  reporter: producerOf(service.source),
});

export function downMessage(input: DownCardInput): AlertMessage {
  const { incident, service } = input;
  return {
    ...base(input, "down", incident),
    subject: subjectOf(service),
    title: `${service.name} is down`,
    reason: input.reason || null,
    startedAt: incident.startedAt,
    endedAt: null,
    durationS: null,
    details: [],
  };
}

export function upMessage(input: UpCardInput): AlertMessage {
  const { incident, service } = input;
  const from = Date.parse(incident.startedAt);
  const back = Date.parse(incident.endedAt ?? incident.startedAt);
  return {
    ...base(input, "up", incident),
    subject: subjectOf(service),
    title: `${service.name} is back up`,
    reason: null,
    startedAt: incident.startedAt,
    endedAt: toIso(back),
    durationS: seconds(back - from),
    details: [],
  };
}
