/**
 * One accepted ingest, after the signature and nonce checks: parse -> adapt -> store.applyDelta ->
 * assemble the site model -> cache.put. Codes against the `Store` and `ModelCache` contract only. The part
 * after the adapter (`applyIngestDelta`) is also how the Worker's own probes apply their results.
 *
 * Before the first ingest of a site (per isolate and config version), the site's configured sources are
 * synced to the store (`syncSiteSources`). Every accepted payload is also kept raw (`Store.recordSnapshot`, 7 days) for
 * debugging; neither step can fail the ingest. Every incident the delta opens or resolves (a service `down`,
 * a `stale` source back) goes to the backend's notifier (src/worker/notify), which cannot fail the ingest either.
 *
 * Ordering: a delta whose `generatedAt` is older than the source's last accepted one (its `lastSeenAt`)
 * is "outdated": its heartbeats are still stored (idempotent history, marked not important so they cannot
 * reopen incidents out of order), but services, facts and `latest:<site>` are left alone.
 */
import type { z } from "zod";
import type { Runtime } from "@/platform/types";
import type { Service } from "@/shared/model";
import { EventsPayload, FactsPayload, KumaSnapshot, ModelDelta } from "@/shared/schemas";
import { isoSeconds } from "../adapters/common";
import { normalizeEvents } from "../adapters/events";
import { normalizeFacts } from "../adapters/facts";
import { normalizeKuma } from "../adapters/kuma";
import { issue, PayloadRejected, zodIssues } from "../ingest/issues";
import type { IngestRoute, KeyBinding } from "../ingest/keys";
import type { IncidentNotifier } from "../notify";
import type { KeyStore } from "./key-store";
import { type ConfigSource, seedConfigs, syncSiteSources } from "./sites";
import type { ModelCache, SiteModel, Store } from "./store";

export interface IngestBackend {
  store: Store;
  cache: ModelCache;
  /** Site configs; the committed `sites/*.json` (`seedConfigs`) when absent. */
  configs?: ConfigSource;
  /** Ingest keys stored in D1; without it only the env keys exist. */
  keys?: KeyStore;
  /** Discord cards for `down` transitions and `stale` recoveries (src/worker/notify); none when absent. */
  notifier?: Pick<IncidentNotifier, "notify">;
  /** Where the instance runs: decides the builtin runner's implied source (`syncSiteSources`). */
  runtime?: Runtime;
}

/** `generatedAt` may run at most this far ahead of the Worker clock. */
export const MAX_FUTURE_S = 300;

export interface IngestOutcome {
  site: string;
  source: string;
  generatedAt: string;
  /** False when the delta was older than the last accepted one for its source. */
  latest: boolean;
  counts: { services: number; heartbeats: number; facts: number };
  incidents: { opened: string[]; resolved: string[] };
}

function parseWith<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) throw new PayloadRejected(zodIssues(r.error));
  return r.data;
}

function adapt(
  route: IngestRoute,
  body: unknown,
  binding: KeyBinding,
  now: Date,
  previous: () => Promise<Service[]>,
): Promise<ModelDelta> | ModelDelta {
  switch (route) {
    case "kuma": {
      const snap = parseWith(KumaSnapshot, body);
      checkFuture(snap.generatedAt, now);
      return previous().then((p) => normalizeKuma(snap, binding.source, binding.site, now, { previous: p }));
    }
    case "facts": {
      const p = parseWith(FactsPayload, body);
      checkFuture(p.generatedAt, now);
      return normalizeFacts(p, binding.source, binding.site, now);
    }
    case "events": {
      const ev = parseWith(EventsPayload, body);
      checkFuture(ev.generatedAt, now);
      return previous().then((p) => normalizeEvents(ev, binding.source, binding.site, now, { previous: p }));
    }
  }
}

function checkFuture(generatedAt: string, now: Date) {
  if (Date.parse(generatedAt) > now.getTime() + MAX_FUTURE_S * 1000) {
    throw new PayloadRejected([issue(["generatedAt"], "generatedAt is too far in the future")]);
  }
}

const later = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b);

/** Logs a failed best-effort step by error name only (the message may quote SQL or values). */
const warn = (step: string, err: unknown) =>
  console.warn(JSON.stringify({ evt: "ingest", step, name: err instanceof Error ? err.name : "unknown" }));

export interface IngestOptions {
  /** The request body as received, for `Store.recordSnapshot`; defaults to `body` re-serialized. */
  rawBody?: string;
}

export async function ingestPayload(
  backend: IngestBackend,
  route: IngestRoute,
  binding: KeyBinding,
  body: unknown,
  now: Date,
  options: IngestOptions = {},
): Promise<IngestOutcome> {
  const { store } = backend;
  await syncSiteSources(store, backend.configs ?? seedConfigs, binding.site, backend.runtime).catch(
    (err: unknown) => warn("sync_sources", err),
  );

  const raw = await adapt(route, body, binding, now, async () =>
    (await store.currentServices(binding.site)).filter((s) => s.source === binding.source),
  );
  return applyIngestDelta(backend, binding, raw, now, { snapshot: options.rawBody ?? JSON.stringify(body) });
}

export interface ApplyDeltaOptions {
  /** The raw payload to keep for debugging (`Store.recordSnapshot`); nothing is recorded without it. */
  snapshot?: string;
}

/**
 * The engine half of an ingest, shared by the ingest routes and the Worker's own probes: validates the
 * delta, applies it (heartbeats, services, facts, incidents, source freshness) and refreshes
 * `latest:<site>`. The caller has synced the site's sources and built `raw` for `binding`.
 */
export async function applyIngestDelta(
  backend: IngestBackend,
  binding: KeyBinding,
  raw: ModelDelta,
  now: Date,
  options: ApplyDeltaOptions = {},
): Promise<IngestOutcome> {
  const { store, cache } = backend;
  const nowIso = isoSeconds(now);
  const checked = ModelDelta.safeParse(raw);
  if (!checked.success) throw new PayloadRejected(zodIssues(checked.error));
  let delta = checked.data;
  const sourceOk = delta.source.ok;

  const cached = await cache.get(binding.site);
  const before = cached ?? (await store.loadSiteModel(binding.site, nowIso));
  const watermark = before.sources.find((s) => s.id === binding.source)?.lastSeenAt ?? null;
  const latest = !watermark || Date.parse(delta.generatedAt) >= Date.parse(watermark);
  if (!latest) {
    delta = {
      ...delta,
      source: { ...delta.source, seenAt: watermark, ok: false, error: null },
      services: [],
      facts: [],
      heartbeats: delta.heartbeats.map((h) => ({ ...h, important: false })),
    };
  }

  const applied = await store.applyDelta(delta);
  await backend.notifier?.notify(binding.site, {
    opened: applied.incidentsOpened,
    resolved: applied.incidentsResolved,
  });
  if (options.snapshot !== undefined) {
    await store
      .recordSnapshot({
        site: binding.site,
        sourceId: binding.source,
        generatedAt: delta.generatedAt,
        ok: sourceOk,
        body: options.snapshot,
      })
      .catch((err: unknown) => warn("record_snapshot", err));
  }

  if (latest) {
    const model: SiteModel = await store.loadSiteModel(binding.site, nowIso);
    const prevGen = cached?.generatedAt;
    const generatedAt = prevGen ? later(prevGen, delta.generatedAt) : delta.generatedAt;
    await cache.put({ ...model, generatedAt });
  }

  return {
    site: binding.site,
    source: binding.source,
    generatedAt: delta.generatedAt,
    latest,
    counts: {
      services: applied.servicesUpserted,
      heartbeats: applied.heartbeatsInserted,
      facts: applied.factsUpserted,
    },
    incidents: {
      opened: applied.incidentsOpened.map((i) => i.id),
      resolved: applied.incidentsResolved.map((i) => i.id),
    },
  };
}
