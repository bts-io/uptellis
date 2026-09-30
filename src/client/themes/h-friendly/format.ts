import type { DisplayState, ServiceView, SiteView, VerdictState } from "@/shared/view";

/** Theme H "Friendly": the plain, warm words of mockups/friendly (times on this page are UTC). */

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export const WORD: Record<DisplayState, string> = {
  up: "Working",
  degraded: "A bit slow",
  pending: "Checking",
  down: "Not working",
  maintenance: "Planned work",
  paused: "Paused",
  unknown: "Not sure",
  stale: "No recent update",
};

/** Pill tones: pastel fill with dark text of the same hue. */
export type Tone = "up" | "warn" | "down" | "maint" | "idle";

export const TONE: Record<DisplayState, Tone> = {
  up: "up",
  degraded: "warn",
  pending: "warn",
  down: "down",
  maintenance: "maint",
  paused: "idle",
  unknown: "idle",
  stale: "idle",
};

export const VERDICT_TONE: Record<VerdictState, Tone> = {
  operational: "up",
  degraded: "warn",
  outage: "down",
  maintenance: "maint",
  stale: "idle",
  empty: "idle",
};

export const KIND: Record<ServiceView["kind"], string> = {
  http: "Website check",
  keyword: "Website content check",
  port: "Connection check",
  ping: "Ping",
  push: "Check-in from the service",
  fact: "System report",
  tls: "Certificate check",
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "just now", "14 minutes ago", "not yet". */
export function ago(seconds: number | null): string {
  if (seconds === null) return "not yet";
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return "just now";
  if (s < 3600) return `${plural(Math.floor(s / 60), "minute")} ago`;
  if (s < 86400) return `${plural(Math.floor(s / 3600), "hour")} ago`;
  return `${plural(Math.floor(s / 86400), "day")} ago`;
}

/** "less than a minute", "6 minutes", "1 hour and 12 minutes", "2 days". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return "less than a minute";
  if (s < 3600) return plural(Math.round(s / 60), "minute");
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return plural(h, "hour") + (m ? ` and ${plural(m, "minute")}` : "");
  }
  return plural(Math.round(s / 86400), "day");
}

export const MONTHS = [
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

/** "23:52 UTC". */
export const clock = (iso: string) => `${iso.slice(11, 16)} UTC`;
/** "27 September" of an ISO instant or a `YYYY-MM-DD` day. */
export const niceDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/** A 0..1 ratio as "99.97%", "not measured yet" when unknown. */
export function pct(r: number | null): string {
  if (r === null) return "not measured yet";
  const p = r * 100;
  return `${p >= 100 ? "100" : p >= 99.995 ? "99.99" : p.toFixed(2)}%`;
}

/** A check interval in words: "30 seconds", "1 minute". */
export const every = (s: number | null) =>
  !s ? null : s < 60 ? plural(s, "second") : plural(Math.round(s / 60), "minute");

/** The ISO instant `seconds` before `now`. */
export const isoBefore = (now: string, seconds: number) =>
  new Date(Date.parse(now) - seconds * 1000).toISOString();

export const allServices = (view: SiteView): ServiceView[] => [
  ...view.sections.flatMap((s) => s.services),
  ...view.unsectioned,
];

/** "A", "A and B", "A, B and C". */
export const listNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** The hero's heading and sentence for the overall state. */
export function heroText(view: SiteView, name: string, ageS: number | null): { h: string; p: string } {
  const services = allServices(view);
  const down = services.filter((s) => s.state === "down").map((s) => s.name);
  const slow = services.filter((s) => s.state === "degraded").map((s) => s.name);
  switch (view.verdict.state) {
    case "operational": {
      const { up, maintenance } = view.summary;
      if (maintenance) {
        return {
          h: "Everything is running smoothly",
          p: `${plural(up, "part")} of ${name} ${up === 1 ? "is" : "are"} up and answering, and ${plural(maintenance, "part")} ${maintenance === 1 ? "is" : "are"} having some planned work. Nothing for you to worry about.`,
        };
      }
      return {
        h: "Everything is running smoothly",
        p: `All ${plural(view.summary.total, "part")} of ${name} are up and answering. Nothing for you to worry about.`,
      };
    }
    case "maintenance":
      return {
        h: "Planned work in progress",
        p: `We're doing some planned work on ${name}, so ${view.summary.maintenance === 1 ? "one part is" : `${plural(view.summary.maintenance, "part")} are`} taking a short break. Nothing is broken, and this page will show them again once the work is done.`,
      };
    case "outage": {
      const who = down.length ? `${listNames(down)} ${down.length === 1 ? "is" : "are"}` : "Some parts are";
      const alsoSlow = slow.length
        ? `, and ${listNames(slow)} ${slow.length === 1 ? "is" : "are"} a bit slow`
        : "";
      return {
        h:
          down.length === 1
            ? `One part of ${name} isn't working right now`
            : `A few parts of ${name} aren't working right now`,
        p: `${who} having trouble${alsoSlow}. Everything else is working normally.`,
      };
    }
    case "degraded": {
      const who = slow.length ? `${listNames(slow)} ${slow.length === 1 ? "is" : "are"}` : "Some parts are";
      return {
        h: "Some things are a little slow right now",
        p: `${who} working, but slower than usual. Everything else is fine.`,
      };
    }
    case "stale":
      return {
        h: "We haven't had an update in a while",
        p: `Our checks last reached us ${ago(ageS)}, so we can't say for sure how things are right now. What you see below is how things looked back then.`,
      };
    default:
      return {
        h: "We're waiting for our first check-in",
        p: "As soon as our checks report in, you'll see how everything is doing here.",
      };
  }
}

/** "88 smooth days out of 90", or "No history yet". */
export function daysCaption(s: ServiceView): string {
  let good = 0;
  let known = 0;
  for (const b of s.beats90d) {
    if (b.worst === null) continue;
    known++;
    if (b.worst === "up") good++;
  }
  return known ? `${plural(good, "smooth day")} out of ${known}` : "No history yet";
}
