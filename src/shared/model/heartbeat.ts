import { z } from "zod";
import { IsoTimestamp, Milliseconds, ServiceId, ServiceStatus, ShortMessage, SiteSlug } from "./common";

export const Heartbeat = z.object({
  site: SiteSlug,
  serviceId: ServiceId,
  ts: IsoTimestamp,
  status: ServiceStatus,
  latencyMs: Milliseconds.nullable(),
  message: ShortMessage.nullable(),
  /** A status transition (Kuma "important" beat); drives incidents. */
  important: z.boolean(),
});
export type Heartbeat = z.infer<typeof Heartbeat>;
