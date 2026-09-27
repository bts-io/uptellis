/**
 * What `buildSiteView` reads. `SiteModel` is the assembled current model the Worker caches in KV
 * (`latest:<site>`) and the read API returns; it lives here so the pure view-model never imports worker code.
 */

import type { SiteConfig } from "../config";
import type { Fact, Heartbeat, Incident, Service, ServiceStatus, Source } from "../model";

/** The assembled current model for one site: what `latest:<site>` holds and the read API returns. */
export interface SiteModel {
  site: string;
  generatedAt: string;
  sources: Source[];
  services: Service[];
  /** Most recent heartbeats per service, newest first, at most `RECENT_BEATS` each. */
  recentHeartbeats: Heartbeat[];
  openIncidents: Incident[];
  recentIncidents: Incident[];
  facts: Fact[];
}

/** One UTC day of a service, folded from `heartbeat_5m` (same shape as the fixtures' `history`). */
export interface DayCell {
  /** `YYYY-MM-DD` (UTC). */
  day: string;
  /** Worst state seen that day. */
  worst: ServiceStatus;
  /** Ratio 0..1 of up time among counted beats (maintenance excluded). */
  uptime: number;
  minutesDown: number;
}

export interface ServiceDays {
  serviceId: string;
  /** Oldest first; days without data are simply absent. */
  days: DayCell[];
}

export interface ViewInput {
  model: SiteModel;
  /** Up to 90 days per service; may be empty (the beat bar then shows no-data cells). */
  history: ServiceDays[];
  config: SiteConfig;
  now: Date | number | string;
}
