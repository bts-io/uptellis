import type { DisplayState, IncidentView, ServiceView, SiteView, VerdictState } from "@/shared/view";

/** Theme E "Editorial": the words and figures of mockups/editorial (times on this page are UTC). */

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export const STATE_WORD: Record<DisplayState, string> = {
  up: "Operational",
  degraded: "Degraded",
  down: "Down",
  maintenance: "Maintenance",
  pending: "Pending",
  paused: "Paused",
  unknown: "Unknown",
  stale: "Stale",
};

export const KICKER: Record<VerdictState, string> = {
  operational: "Operating normally",
  degraded: "Service degraded",
  outage: "Service disruption",
  stale: "Report out of date",
  empty: "Awaiting first report",
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "34 seconds ago", "14 minutes ago", "never". */
export function ago(seconds: number | null): string {
  if (seconds === null) return "never";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${plural(s, "second")} ago`;
  if (s < 3600) return `${plural(Math.floor(s / 60), "minute")} ago`;
  if (s < 86400) return `${plural(Math.floor(s / 3600), "hour")} ago`;
  return `${plural(Math.floor(s / 86400), "day")} ago`;
}

/** "6 minutes", "1 hour 12 minutes", "2 days 3 hours". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return plural(s, "second");
  if (s < 3600) return plural(Math.round(s / 60), "minute");
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (s < 86400) return plural(h, "hour") + (m ? ` ${plural(m, "minute")}` : "");
  return plural(Math.floor(s / 86400), "day") + (h % 24 ? ` ${plural(h % 24, "hour")}` : "");
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const at = (iso: string) => new Date(iso);

/** "27 September 2026". */
export const longDate = (iso: string) => {
  const t = at(iso);
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${t.getUTCFullYear()}`;
};
/** "27 Sep". */
export const shortDate = (iso: string) => {
  const t = at(iso);
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]!.slice(0, 3)}`;
};
/** "23:52 UTC". */
export const clock = (iso: string) => `${iso.slice(11, 16)} UTC`;

/** A 0..1 ratio as "99.97%", "n/a" when unmeasured. */
export function pct(r: number | null): string {
  if (r === null) return "n/a";
  const p = r * 100;
  return `${p >= 100 ? "100" : p >= 99.995 ? "99.99" : p.toFixed(2)}%`;
}

/** The ISO instant `seconds` before `now`. */
export const isoBefore = (now: string, seconds: number) =>
  new Date(Date.parse(now) - seconds * 1000).toISOString();

export const allServices = (view: SiteView): ServiceView[] => [
  ...view.sections.flatMap((s) => s.services),
  ...view.unsectioned,
];

/** The lead's standfirst: one plain paragraph that says what the reader needs to know. */
export function standfirst(view: SiteView, ageS: number | null): string {
  const total = view.summary.total;
  const state = view.verdict.state;
  if (state === "stale") {
    return `Our monitors last reported ${ago(ageS)}. Until they check in again, read everything below as the last known picture of ${plural(total, "service")}, not as the current one.`;
  }
  if (state === "empty") {
    return `No monitor has reported yet, so there is nothing to say about the ${plural(total, "service")} on this page.`;
  }
  const bad = allServices(view).filter((s) => s.state === "down" || s.state === "degraded");
  if (bad.length) {
    const parts = bad.map((s) => {
      const inc = view.incidents.open.find((i) => i.id === s.openIncidentId);
      return `${s.name} is ${s.state === "down" ? "down" : "degraded"}${inc ? `, for ${duration(inc.durationS)} so far` : ""}`;
    });
    const ok = total - bad.length;
    const rest =
      ok <= 0
        ? ""
        : ` ${ok === 1 ? "The one other service is" : `The other ${ok} services are`} answering normally.`;
    return `${parts.join("; ")}.${rest}`;
  }
  const lat =
    view.summary.avgLatencyMs !== null ? ` in ${Math.round(view.summary.avgLatencyMs)} ms on average` : "";
  const up = view.summary.uptime30d;
  return `All ${plural(total, "service")} across ${plural(view.sections.length, "section")} answered their latest checks${lat}${up !== null ? `, with ${pct(up)} uptime over the past 30 days.` : "."}`;
}

/** The body of a news item: what happened, when, and whether it is still open. */
export function newsBody(i: IncidentView, open: boolean): string {
  const stale = i.kind === "stale";
  const body = open
    ? `${stale ? `Reports from ${i.subject} stopped arriving at ` : `${i.subject} stopped answering at `}${clock(i.startedAt)} and has been out for ${duration(i.durationS)}. It is still open.`
    : `${stale ? `Reports from ${i.subject} went quiet at ` : `${i.subject} went down at `}${clock(i.startedAt)}${i.endedAt ? ` and was back at ${clock(i.endedAt)}, after ${duration(i.durationS)}.` : "."}`;
  const steps =
    i.steps.length > 2 ? ` Timeline: ${i.steps.map((s) => `${s.label} ${clock(s.ts)}`).join(", ")}.` : "";
  return body + steps + (i.notes ? ` ${i.notes}` : "");
}

/** "90 days: 88 clear, 2 with problems". */
export function barSummary(s: ServiceView): string {
  let up = 0;
  let bad = 0;
  let none = 0;
  for (const b of s.beats90d) {
    if (b.worst === "up") up++;
    else if (b.worst === null) none++;
    else bad++;
  }
  return `${s.beats90d.length} days: ${up} clear, ${bad} with problems${none ? `, ${none} without data` : ""}`;
}
