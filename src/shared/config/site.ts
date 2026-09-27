import { z } from "zod";
import {
  HostLabel,
  Hostname,
  ServiceId,
  SiteSlug,
  SourceId,
  SourceKind,
  sourceKindOf,
} from "../model/common";
import { containsForbiddenLiteral, safeDisplay } from "../model/safety";

export { SourceKind };

export const THEME_IDS = ["a-sys-status", "b-control-room", "c-session"] as const;
export const ThemeId = z.enum(THEME_IDS);
export type ThemeId = z.infer<typeof ThemeId>;

/** Fields a site may expose on `/api/public/:site/summary.json` and the embeds (allow-list). */
export const PUBLIC_FIELDS = [
  "verdict",
  "sections",
  "serviceNames",
  "uptime90d",
  "incidentTitles",
  "generatedAt",
] as const;
export const PublicField = z.enum(PUBLIC_FIELDS);
export type PublicField = z.infer<typeof PublicField>;

export const NODE_ROLES = ["primary", "standby", "watchdog", "runner", "other"] as const;
export const NodeRole = z.enum(NODE_ROLES);
export type NodeRole = z.infer<typeof NodeRole>;

export const TopologyNode = z.object({
  /** Machine name, e.g. `app-1`. */
  id: HostLabel,
  label: safeDisplay(80),
  roles: z.array(NodeRole).min(1).max(5),
  /** e.g. `Frankfurt`, `Office LAN`. */
  location: safeDisplay(80).optional(),
});
export type TopologyNode = z.infer<typeof TopologyNode>;

export const EDGE_KINDS = ["replication", "watches", "depends", "network"] as const;
export const EdgeKind = z.enum(EDGE_KINDS);
export type EdgeKind = z.infer<typeof EdgeKind>;

export const TopologyEdge = z.object({
  from: HostLabel,
  to: HostLabel,
  kind: EdgeKind,
  label: safeDisplay(80).optional(),
});
export type TopologyEdge = z.infer<typeof TopologyEdge>;

/** Worker secret name that holds an outbound webhook URL (never the URL itself). */
const SecretName = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/, "Expected a secret name like NOTIFY_HOOK_OPS");

const SectionId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/);

/** The one source every probe of a site reports as (the Worker's own edge checks). */
export const PROBE_SOURCE_ID = "probe:cf";

/** Suffixes of names that only resolve inside a LAN or tailnet; probes check public URLs only. */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".ts.net"] as const;

/** A public https URL on a DNS hostname: no credentials, no address literal, no private-only name. */
const ProbeUrl = z
  .url({ protocol: /^https$/ })
  .refine((u) => !containsForbiddenLiteral(u), { message: "Probe URL must not contain an address literal" })
  .refine(
    (u) => {
      const url = URL.parse(u);
      return (
        !!url &&
        !url.username &&
        !url.password &&
        Hostname.safeParse(url.hostname).success &&
        !PRIVATE_SUFFIXES.some((s) => `.${url.hostname}`.endsWith(s))
      );
    },
    { message: "Probe URL must be a public https URL on a hostname, without credentials" },
  );

/** An HTTP check the Worker runs from Cloudflare's edge (service id `probe:<id>`). */
export const ProbeConfig = z.object({
  id: SectionId,
  name: safeDisplay(150),
  url: ProbeUrl,
  method: z.enum(["GET", "HEAD"]).default("GET"),
  /** Inclusive range of statuses that count as up; redirects are never followed. */
  expectStatus: z
    .object({ min: z.number().int().min(100).max(599), max: z.number().int().min(100).max(599) })
    .refine((r) => r.min <= r.max, { message: "min must not exceed max" })
    .default({ min: 200, max: 399 }),
  timeoutS: z.number().int().min(1).max(30).default(10),
  /** How often the check runs; the probe cron fires every minute, so whole minutes only. */
  intervalS: z
    .number()
    .int()
    .min(60)
    .max(3600)
    .refine((s) => s % 60 === 0, { message: "Interval must be whole minutes" })
    .default(60),
});
export type ProbeConfig = z.infer<typeof ProbeConfig>;

export const SiteConfig = z
  .object({
    v: z.literal(1),
    slug: SiteSlug,
    name: safeDisplay(80),
    hostnames: z.array(Hostname).min(1),
    theme: ThemeId,
    /** `public`: anyone sees the page; `private`: signed-in users with a role only (see src/shared/auth.ts). */
    visibility: z.enum(["public", "private"]).default("private"),
    /** Active profiles in order (src/shared/profiles); `generic` is always active and need not be listed. */
    profiles: z
      .array(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/))
      .max(10)
      .default([]),
    sources: z.array(
      z.object({ id: SourceId, kind: SourceKind, expectedIntervalS: z.number().int().positive() }),
    ),
    probes: z.array(ProbeConfig).max(20).default([]),
    sections: z.array(z.object({ id: SectionId, title: safeDisplay(80), services: z.array(ServiceId) })),
    displayNames: z.record(ServiceId, safeDisplay(150)).default({}),
    /** Tailnet name -> label; never addresses (keys and values are display-checked). */
    hostAliases: z.record(safeDisplay(64), safeDisplay(80)).default({}),
    topology: z.object({ nodes: z.array(TopologyNode), edges: z.array(TopologyEdge) }).optional(),
    health: z
      .object({ uptime: z.number(), latency: z.number(), cert: z.number() })
      .default({ uptime: 0.6, latency: 0.25, cert: 0.15 }),
    thresholds: z
      .object({
        certWarnDays: z.number().default(14),
        certCritDays: z.number().default(7),
        lagWarnS: z.number().default(5),
        lagCritS: z.number().default(60),
        backupMaxAgeH: z.number().default(26),
      })
      .prefault({}),
    links: z
      .array(
        z.object({
          label: safeDisplay(80),
          href: z.url({ protocol: /^https?$/ }).refine((u) => !containsForbiddenLiteral(u), {
            message: "Link must not contain an address literal or token",
          }),
        }),
      )
      .max(10)
      .default([]),
    branding: z.object({
      title: safeDisplay(80),
      tagline: safeDisplay(160).optional(),
      tokens: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), z.string().max(200)).default({}),
    }),
    public: z
      .object({ enabled: z.boolean().default(false), fields: z.array(PublicField).default([]) })
      .prefault({}),
    notify: z
      .object({ discord: z.boolean().default(false), webhooks: z.array(SecretName).default([]) })
      .prefault({}),
  })
  .superRefine((c, ctx) => {
    for (const [i, s] of c.sources.entries()) {
      if (sourceKindOf(s.id) !== s.kind) {
        ctx.addIssue({
          code: "custom",
          message: "Source id prefix must match its kind",
          path: ["sources", i, "id"],
        });
      }
    }
    const dup = <T>(
      items: T[],
      key: (t: T) => string,
      path: (i: number) => (string | number)[],
      what: string,
    ) => {
      const seen = new Set<string>();
      for (const [i, it] of items.entries()) {
        const k = key(it);
        if (seen.has(k)) ctx.addIssue({ code: "custom", message: `Duplicate ${what} ${k}`, path: path(i) });
        seen.add(k);
      }
    };
    dup(
      c.sources,
      (s) => s.id,
      (i) => ["sources", i, "id"],
      "source",
    );
    dup(
      c.probes,
      (p) => p.id,
      (i) => ["probes", i, "id"],
      "probe",
    );
    if (c.probes.length > 0 && !c.sources.some((s) => s.id === PROBE_SOURCE_ID)) {
      ctx.addIssue({
        code: "custom",
        message: `Probes need the source ${PROBE_SOURCE_ID}`,
        path: ["sources"],
      });
    }
    dup(
      c.sections,
      (s) => s.id,
      (i) => ["sections", i, "id"],
      "section",
    );
    if (c.topology) {
      dup(
        c.topology.nodes,
        (n) => n.id,
        (i) => ["topology", "nodes", i, "id"],
        "node",
      );
      const nodes = new Set(c.topology.nodes.map((n) => n.id));
      for (const [i, e] of c.topology.edges.entries()) {
        for (const end of ["from", "to"] as const) {
          if (!nodes.has(e[end])) {
            ctx.addIssue({
              code: "custom",
              message: `Unknown node ${e[end]}`,
              path: ["topology", "edges", i, end],
            });
          }
        }
      }
    }
  });
export type SiteConfig = z.infer<typeof SiteConfig>;
/** What an editor or a JSON file may supply before defaults are applied. */
export type SiteConfigInput = z.input<typeof SiteConfig>;

/** Parses a config object or its JSON text; throws a ZodError (or SyntaxError) on bad input. */
export function parseSiteConfig(input: unknown): SiteConfig {
  return SiteConfig.parse(typeof input === "string" ? JSON.parse(input) : input);
}

type AnyDef = {
  type: string;
  shape?: Record<string, z.ZodType>;
  innerType?: z.ZodType;
  element?: z.ZodType;
  valueType?: z.ZodType;
};
const defOf = (schema: z.ZodType) => (schema as unknown as { _zod: { def: AnyDef } })._zod.def;

/** Orders object keys as the schema declares them and record keys alphabetically. */
function canonicalize(schema: z.ZodType, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const def = defOf(schema);
  switch (def.type) {
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
      return canonicalize(def.innerType!, value);
    case "array":
      return (value as unknown[]).map((v) => canonicalize(def.element!, v));
    case "object": {
      const src = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, s] of Object.entries(def.shape!)) {
        if (src[k] !== undefined) out[k] = canonicalize(s, src[k]);
      }
      return out;
    }
    case "record": {
      const src = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(src).sort()) out[k] = canonicalize(def.valueType!, src[k]);
      return out;
    }
    default:
      return value;
  }
}

/**
 * Validates and serializes a config for `sites/<slug>.json`: defaults applied, keys in schema order
 * (records sorted), 2-space JSON, trailing newline. `exportSiteConfig(parseSiteConfig(text)) === text`
 * for any exported file.
 */
export function exportSiteConfig(config: SiteConfigInput | SiteConfig): string {
  const parsed = SiteConfig.parse(config);
  return `${JSON.stringify(canonicalize(SiteConfig, parsed), null, 2)}\n`;
}
