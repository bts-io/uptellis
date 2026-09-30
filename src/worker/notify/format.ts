/**
 * What every channel says about an `AlertMessage`, before each provider dresses it for its service: the
 * heading (`TEST: Uptellis: Checkout is down`), one line on what it means, and the `Key: value` facts the
 * Discord cards have always shown (then the reason and the dispatcher's detail lines). Pure; the helpers
 * for sources, spans and times the cards and the dispatcher share live here too.
 */
import { FRESHNESS_FACTORS, type Incident, type Source } from "@/shared/model";
import { PUSH_SOURCE_ID } from "@/shared/monitors";
import type { AlertMessage, NotifyEvent } from "@/shared/notify";

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
  if (sourceId === PUSH_SOURCE_ID) return "calls to its push URL";
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

/** The heading emoji of each event. */
export const EMOJI: Record<NotifyEvent, string> = { down: "🔴", up: "✅", stale: "🚨", recovered: "✅" };

/** `Uptellis: Checkout is down`, `TEST: ` first on a test message. */
export const headline = (m: AlertMessage) => `${m.test ? "TEST: " : ""}Uptellis: ${m.title}`;

const TEST_NOTHING: Record<NotifyEvent, string> = {
  down: "nothing is down.",
  up: "nothing changed.",
  stale: "nothing is silent.",
  recovered: "nothing changed.",
};

const MEANING: Record<NotifyEvent, string> = {
  down: "Confirmed down; an incident is open on the status page.",
  up: "Up again; the incident is resolved.",
  stale: "The status page shows its data as stale until it reports again.",
  recovered: "Reporting again; the status page is current.",
};

/** One line on what the event means; `noun` names the message on a test (`card` on Discord). */
export function descriptionOf(m: AlertMessage, noun = "message"): string {
  if (m.test)
    return `Test ${noun} from the admin panel, built from the current state: ${TEST_NOTHING[m.event]}`;
  return MEANING[m.event];
}

/**
 * The facts of a message in the Discord cards' order: the subject, its times, then the reason and the
 * detail lines. Ages (`6 min ago`) are measured against `sentAt`.
 */
export function factsOf(m: AlertMessage): [string, string][] {
  const out: [string, string][] = [];
  const start = Date.parse(m.startedAt);
  const end = m.endedAt === null ? null : Date.parse(m.endedAt);
  const span = m.durationS === null ? null : duration(m.durationS * 1000);
  const s = m.subject;
  if (s.kind === "service") {
    out.push(["Service", s.id]);
    if (m.event === "down") {
      if (s.target) out.push(["Target", s.target]);
      if (s.reporter) out.push(["Checked by", s.reporter]);
      out.push(["Down since", `${utc(start)} (${duration(Date.parse(m.sentAt) - start)} ago)`]);
    } else {
      if (span !== null) out.push(["Down for", span]);
      out.push(["Down since", utc(start)]);
      if (end !== null) out.push(["Back up", utc(end)]);
    }
  } else {
    if (s.reporter) out.push(["Producer", s.reporter]);
    if (m.event === "recovered") {
      if (span !== null) out.push(["Silent for", span]);
      if (end !== null) out.push(["First report again", utc(end)]);
    }
  }
  if (m.reason) out.push(["Reason", m.reason]);
  for (const d of m.details) out.push([d.label, d.value]);
  return out;
}

/** `Uptellis · demo · 2026-09-27 10:15 UTC`: where and when, for the footers. */
export const footerOf = (m: AlertMessage) => `Uptellis · ${m.site.slug} · ${utc(Date.parse(m.sentAt))}`;

/**
 * The plain text form (ntfy bodies, email text): heading (unless `heading` is false), meaning, facts,
 * the status page and the footer.
 */
export function textSummary(m: AlertMessage, opts: { heading?: boolean } = {}): string {
  const lines = [
    ...(opts.heading === false ? [] : [`${EMOJI[m.event]} ${headline(m)}`]),
    descriptionOf(m),
    "",
    ...factsOf(m).map(([k, v]) => `${k}: ${v}`),
    "",
    ...(m.pageUrl ? [`Status page: ${m.pageUrl}`] : []),
    footerOf(m),
  ];
  return lines.join("\n");
}
