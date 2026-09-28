/**
 * Pure incident derivation, shared by the D1 store and the ingest stream's in-memory store.
 *
 * `down` incidents belong to a service: a `down` status opens one when none is open; `up` (or `degraded`,
 * which still answers) closes it. `pending`, `maintenance`, `paused` and `unknown` neither open nor close,
 * so maintenance never counts as downtime. `stale` incidents belong to a source whose freshness is `stale`
 * (see `sourceFreshness`); they close once the source is `fresh` or `aging` again.
 *
 * Every heartbeat counts, whatever its `important` flag: Kuma marks only transitions important, but a run
 * of `down` beats still means the service is down, and a lost important beat must not hide an outage.
 *
 * Everything is idempotent: ids are `incidentId(subject, startedAt)` on canonical timestamps, replayed or
 * older heartbeats (at or before the end of the subject's latest closed incident) are ignored, and a
 * subject with an open incident never gets a second one. A whole delta older than its source's last
 * accepted one is history only (`isOutdatedDelta`): its beats are stored but never open or close anything.
 *
 * This is the only incident rule in the engine: `D1Store` and the in-memory test stores both go through
 * `deriveDeltaIncidents` (per accepted delta) and `deriveStaleIncidents` (per staleness sweep).
 */
import {
  FRESHNESS_FACTORS,
  type Heartbeat,
  type Incident,
  incidentId,
  type Service,
  type ServiceStatus,
  type Source,
  sourceFreshness,
} from "@/shared/model";
import type { ModelDelta } from "@/shared/schemas";

export interface IncidentTransitions {
  /** New incidents. One that opened and closed within the same input carries its `endedAt`. */
  opened: Incident[];
  /** Incidents that closed (including any opened and closed within the same input), with `endedAt` set. */
  resolved: Incident[];
}

export interface DownInput {
  site: string;
  /** When the status change is known only from a service row (no heartbeat), e.g. the delta's generatedAt. */
  at: string;
  /** Service rows before the change (`Store.currentServices`); used for names of services not in `after`. */
  before: readonly Service[];
  /** Service rows after the change (the delta's services). The final status of each wins. */
  after: readonly Service[];
  /** New heartbeats, any order. */
  heartbeats: readonly Heartbeat[];
  /** Known incidents of the site: at least every open one and the latest closed one per subject. */
  incidents: readonly Incident[];
}

export interface StaleInput {
  site: string;
  sources: readonly Source[];
  /** Known incidents of the site: at least every open `stale` one. */
  incidents: readonly Incident[];
  now: string;
  /**
   * The sources the site watches (configured plus the implied monitor runners). Only these can go stale;
   * an open `stale` incident of any other source (removed from the config, such as a retired agent) is
   * resolved at `now` with `RETIRED_NOTE`. Absent: every source is watched.
   */
  watched?: ReadonlySet<string>;
}

/** The note on a `stale` incident resolved because its source is no longer in the config. */
export const RETIRED_NOTE = "Source removed from the config";

const OPENS: ReadonlySet<ServiceStatus> = new Set(["down"]);
const CLOSES: ReadonlySet<ServiceStatus> = new Set(["up", "degraded"]);

const ms = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t).toISOString().replace(".000Z", "Z");

/** Whether a status opens a `down` incident, closes one, or leaves it as it is. */
export function statusEffect(status: ServiceStatus): "open" | "close" | "none" {
  return OPENS.has(status) ? "open" : CLOSES.has(status) ? "close" : "none";
}

interface SubjectState {
  open: Incident | null;
  /** End of the latest closed incident (ms), or -Infinity. */
  lastEnd: number;
}

function subjectState(
  incidents: readonly Incident[],
  kind: Incident["kind"],
  match: (i: Incident) => boolean,
): SubjectState {
  let open: Incident | null = null;
  let lastEnd = Number.NEGATIVE_INFINITY;
  for (const i of incidents) {
    if (i.kind !== kind || !match(i)) continue;
    if (i.endedAt === null) {
      if (!open || ms(i.startedAt) > ms(open.startedAt)) open = i;
    } else {
      lastEnd = Math.max(lastEnd, ms(i.endedAt));
    }
  }
  return { open, lastEnd };
}

function mergeInto(out: IncidentTransitions, t: IncidentTransitions) {
  out.opened.push(...t.opened);
  out.resolved.push(...t.resolved);
}

/** `down` incidents opened or resolved by new heartbeats and service rows. */
export function deriveDownIncidents(input: DownInput): IncidentTransitions {
  const out: IncidentTransitions = { opened: [], resolved: [] };
  const names = new Map<string, string>();
  for (const s of input.before) names.set(s.id, s.name);
  for (const s of input.after) names.set(s.id, s.name);
  const finalStatus = new Map(input.after.map((s) => [s.id, s.status]));

  const beats = new Map<string, Heartbeat[]>();
  for (const h of input.heartbeats) {
    const list = beats.get(h.serviceId) ?? [];
    list.push(h);
    beats.set(h.serviceId, list);
  }
  const ids = [...new Set([...finalStatus.keys(), ...beats.keys()])].sort();

  for (const serviceId of ids) {
    const state = subjectState(input.incidents, "down", (i) => i.serviceId === serviceId);
    const title = `${names.get(serviceId) ?? serviceId} down`;
    // `fresh` is the incident opened by this input while it is still open.
    const cur: { open: Incident | null; fresh: Incident | null } = { open: state.open, fresh: null };

    const openAt = (t: number) => {
      const startedAt = iso(t);
      const incident: Incident = {
        id: incidentId(serviceId, startedAt),
        site: input.site,
        kind: "down",
        serviceId,
        sourceId: null,
        startedAt,
        endedAt: null,
        title,
        notes: null,
      };
      cur.open = incident;
      cur.fresh = incident;
    };
    const closeAt = (open: Incident, t: number) => {
      const closed: Incident = { ...open, endedAt: iso(t) };
      if (cur.fresh?.id === open.id) out.opened.push(closed);
      out.resolved.push(closed);
      state.lastEnd = t;
      cur.open = null;
      cur.fresh = null;
    };

    const list = (beats.get(serviceId) ?? [])
      .map((h) => ({ t: ms(h.ts), effect: statusEffect(h.status) }))
      .filter((b) => !Number.isNaN(b.t))
      .sort((a, b) => a.t - b.t);
    let lastBeat = Number.NEGATIVE_INFINITY;
    for (const b of list) {
      lastBeat = b.t;
      if (b.t <= state.lastEnd) continue;
      if (b.effect === "open" && !cur.open) openAt(b.t);
      else if (b.effect === "close" && cur.open && b.t >= ms(cur.open.startedAt)) closeAt(cur.open, b.t);
    }

    // Reconcile with the service row's final status (a change seen without a heartbeat).
    const status = finalStatus.get(serviceId);
    if (status) {
      const effect = statusEffect(status);
      const at = Math.max(ms(input.at), lastBeat);
      if (effect === "open" && !cur.open && at > state.lastEnd) openAt(at);
      else if (effect === "close" && cur.open && at >= ms(cur.open.startedAt)) closeAt(cur.open, at);
    }
    if (cur.fresh) out.opened.push(cur.fresh);
  }
  return out;
}

/** `stale` incidents opened or resolved by source freshness at `now`. */
export function deriveStaleIncidents(input: StaleInput): IncidentTransitions {
  const out: IncidentTransitions = { opened: [], resolved: [] };
  const now = ms(input.now);
  const known = new Set(input.incidents.map((i) => i.id));
  const { watched } = input;
  if (watched) {
    for (const open of input.incidents) {
      if (open.kind !== "stale" || open.endedAt || !open.sourceId || watched.has(open.sourceId)) continue;
      out.resolved.push({ ...open, endedAt: iso(Math.max(now, ms(open.startedAt))), notes: RETIRED_NOTE });
    }
  }
  for (const source of [...input.sources].sort((a, b) => a.id.localeCompare(b.id))) {
    if (watched && !watched.has(source.id)) continue;
    const { open } = subjectState(input.incidents, "stale", (i) => i.sourceId === source.id);
    const freshness = sourceFreshness(source, now);
    if (freshness === "stale" && !open && source.lastSeenAt) {
      // Deterministic start: the moment the silence crossed the stale threshold.
      const startedAt = iso(
        ms(source.lastSeenAt) + FRESHNESS_FACTORS.stale * source.expectedIntervalS * 1000,
      );
      const id = incidentId(source.id, startedAt);
      if (known.has(id)) continue;
      out.opened.push({
        id,
        site: input.site,
        kind: "stale",
        serviceId: null,
        sourceId: source.id,
        startedAt,
        endedAt: null,
        title: `Source ${source.id} stale`,
        notes: null,
      });
    } else if ((freshness === "fresh" || freshness === "aging") && open && source.lastSeenAt) {
      const endedAt = iso(Math.max(ms(source.lastSeenAt), ms(open.startedAt)));
      out.resolved.push({ ...open, endedAt });
    }
  }
  return out;
}

/** Both kinds at once (the shape `Store.applyDelta` records). */
export function deriveIncidents(down: DownInput, stale?: StaleInput): IncidentTransitions {
  const out: IncidentTransitions = { opened: [], resolved: [] };
  mergeInto(out, deriveDownIncidents(down));
  if (stale) mergeInto(out, deriveStaleIncidents(stale));
  return out;
}

export interface DeltaInput {
  delta: ModelDelta;
  /** Service rows before the delta (`Store.currentServices`). */
  before: readonly Service[];
  /** Known incidents of the site: at least every open one and the latest closed one per subject. */
  incidents: readonly Incident[];
  /** The delta's source as stored before the delta, or null if it was never seen. */
  previous: Pick<Source, "lastSeenAt"> | null;
  /** The delta's source as it will be after the delta (last seen already moved forward). */
  touched: Source;
}

/**
 * True when the delta was generated before its source's last accepted delta was seen: a late or replayed
 * snapshot. The ingest service already strips its services and facts; the stores keep its heartbeats as
 * history but derive nothing from them, so an old `down` beat can never reopen an outage that later
 * beats (already stored, not in this input) closed.
 */
export function isOutdatedDelta(
  delta: Pick<ModelDelta, "generatedAt">,
  previous: Pick<Source, "lastSeenAt"> | null,
): boolean {
  return !!previous?.lastSeenAt && ms(delta.generatedAt) < ms(previous.lastSeenAt);
}

/** Every incident transition one accepted delta causes: `down` from its beats and rows, `stale` from its source. */
export function deriveDeltaIncidents(input: DeltaInput): IncidentTransitions {
  const { delta } = input;
  const out: IncidentTransitions = { opened: [], resolved: [] };
  if (!isOutdatedDelta(delta, input.previous)) {
    mergeInto(
      out,
      deriveDownIncidents({
        site: delta.site,
        at: delta.generatedAt,
        before: input.before,
        after: delta.services,
        heartbeats: delta.heartbeats,
        incidents: input.incidents,
      }),
    );
  }
  if (input.touched.lastSeenAt) {
    mergeInto(
      out,
      deriveStaleIncidents({
        site: delta.site,
        sources: [input.touched],
        incidents: input.incidents,
        now: input.touched.lastSeenAt,
      }),
    );
  }
  return out;
}
