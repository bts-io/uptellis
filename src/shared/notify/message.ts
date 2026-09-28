/**
 * Phase 6b contract (lead): the one alert message every channel renders (a Discord card, a Slack block, an
 * ntfy notification, a Telegram message, an email, the signed webhook body). Built once per incident
 * transition by the dispatcher from the same data the Discord cards use today; providers only format it.
 * Every text field is display-safe: no addresses, no secrets.
 */
import { z } from "zod";
import { IsoTimestamp, ServiceId, SiteSlug, SourceId } from "../model/common";
import { safeDisplay } from "../model/safety";
import { NotifyEvent } from "./schema";

export const AlertSeverity = z.enum(["critical", "warning", "resolved"]);
export type AlertSeverity = z.infer<typeof AlertSeverity>;

/** `down` is critical, `stale` a warning, `up` and `recovered` resolved. */
export const SEVERITY_OF: Record<NotifyEvent, AlertSeverity> = {
  down: "critical",
  stale: "warning",
  up: "resolved",
  recovered: "resolved",
};

export const AlertMessage = z.object({
  v: z.literal(1),
  event: NotifyEvent,
  severity: AlertSeverity,
  /** The incident this transition belongs to (`test:<subject>` on a test message). */
  incidentId: z.string().min(1).max(200),
  site: z.object({ slug: SiteSlug, name: safeDisplay(80) }),
  /** A service (down, up) or a source (stale, recovered). */
  subject: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("service"),
      id: ServiceId,
      name: safeDisplay(150),
      /** Host + path or host:port; null when not displayable (private targets). */
      target: safeDisplay(300).nullable(),
      /** Who saw it: `Cloudflare edge`, `agent office-1`, `Uptime Kuma on watch-1`. */
      reporter: safeDisplay(120).nullable(),
    }),
    z.object({ kind: z.literal("source"), id: SourceId, reporter: safeDisplay(120).nullable() }),
  ]),
  /** One line: `Checkout is down`, `kuma:watch-1 went silent`. */
  title: safeDisplay(200),
  /** The failing check's message (`HTTP 503`, `timeout`) or why a source is stale; null when none. */
  reason: safeDisplay(200).nullable(),
  startedAt: IsoTimestamp,
  /** Set on `up` and `recovered`. */
  endedAt: IsoTimestamp.nullable(),
  /** Outage or silence length in seconds, set on `up` and `recovered`. */
  durationS: z.number().int().nonnegative().nullable(),
  /** The status page, when the site has a public URL. */
  pageUrl: z.url().nullable(),
  /** True for messages sent from admin's "send test"; providers label them TEST. */
  test: z.boolean(),
  /** When the message was built. */
  sentAt: IsoTimestamp,
});
export type AlertMessage = z.infer<typeof AlertMessage>;
