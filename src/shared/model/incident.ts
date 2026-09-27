import { z } from "zod";
import { IsoTimestamp, ServiceId, SiteSlug, SourceId } from "./common";
import { safeDisplay } from "./safety";

export const INCIDENT_KINDS = ["down", "stale"] as const;
export const IncidentKind = z.enum(INCIDENT_KINDS);
export type IncidentKind = z.infer<typeof IncidentKind>;

/**
 * Derived, never hand-entered at first. `down` incidents belong to a service, `stale` incidents to a
 * source that went silent (serviceId null, sourceId set).
 */
export const Incident = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9:._-]{1,128}$/),
    site: SiteSlug,
    kind: IncidentKind,
    serviceId: ServiceId.nullable(),
    sourceId: SourceId.nullable(),
    startedAt: IsoTimestamp,
    endedAt: IsoTimestamp.nullable(),
    title: safeDisplay(200),
    notes: safeDisplay(2000).nullable(),
  })
  .superRefine((i, ctx) => {
    if (i.kind === "down" && !i.serviceId) {
      ctx.addIssue({ code: "custom", message: "A down incident needs a serviceId", path: ["serviceId"] });
    }
    if (i.kind === "stale" && !i.sourceId) {
      ctx.addIssue({ code: "custom", message: "A stale incident needs a sourceId", path: ["sourceId"] });
    }
    if (i.endedAt && Date.parse(i.endedAt) < Date.parse(i.startedAt)) {
      ctx.addIssue({ code: "custom", message: "endedAt is before startedAt", path: ["endedAt"] });
    }
  });
export type Incident = z.infer<typeof Incident>;

/** Stable incident id: `<serviceId or sourceId>:<startedAt>`, e.g. `kuma:5:2026-09-27T23:52:00Z`. */
export function incidentId(subjectId: string, startedAt: string): string {
  return `${subjectId}:${startedAt}`;
}
