import { useState } from "react";
import { VISIBILITIES } from "@/shared/auth";
import { SiteConfig } from "@/shared/config";
import { monitorServiceId, monitorsOf } from "@/shared/monitors";
import { listProfiles } from "@/shared/profiles";
import type { ConfigDiffEntry, ConfigIssue, ConfigState } from "@/shared/schemas/admin";
import { registeredThemes } from "../../themes";
import { ChannelsField } from "./ChannelsEditor";
import { type AdminFailure, describeFailure, importConfig, saveConfig } from "./client";
import { AgentsField, AlertsField, MaintenanceField, MonitorsField } from "./MonitorsEditor";
import { PublicSettings } from "./PublicEditor";
import { Button, Card, DiffTable, Field, IssueText, inputClass, issuesAt, Notice, SelectField } from "./ui";

export interface KnownService {
  id: string;
  name: string;
}

const VISIBILITY_HELP: Record<SiteConfig["visibility"], string> = {
  public: "Anyone can open the page and its read API.",
  private: "Only signed-in users see the page; everyone else gets a 404.",
};

const THRESHOLDS = [
  ["certWarnDays", "Cert warning (days)"],
  ["certCritDays", "Cert critical (days)"],
  ["lagWarnS", "Replication lag warning (s)"],
  ["lagCritS", "Replication lag critical (s)"],
  ["backupMaxAgeH", "Backup max age (h)"],
] as const;

type Candidate = { ok: true; value: unknown } | { ok: false; message: string };

/** Client-side check with the same schema the server applies; issues use the API's dotted paths. */
export function validateConfig(value: unknown): ConfigIssue[] {
  const r = SiteConfig.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

const move = <T,>(list: T[], i: number, by: -1 | 1): T[] => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
};

export interface ConfigEditorProps {
  site: string;
  state: ConfigState;
  services: KnownService[];
  /** Reloads the saved state (after a save, or to start over from someone else's version). */
  onReload: () => void;
}

/**
 * The config editor: a form for the common fields and a raw JSON tab over the same draft. "Review changes"
 * asks the server for the diff (an import dry run of the draft) before Save; a save against a stale version
 * gets a 409 and offers a reload.
 */
export function ConfigEditor({ site, state, services, onReload }: ConfigEditorProps) {
  const [draft, setDraft] = useState<SiteConfig>(state.config);
  const [mode, setMode] = useState<"form" | "json">("form");
  const [json, setJson] = useState("");
  const [review, setReview] = useState<ConfigDiffEntry[] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AdminFailure | null>(null);

  const candidate: Candidate =
    mode === "form"
      ? { ok: true, value: draft }
      : (() => {
          try {
            return { ok: true, value: JSON.parse(json) as unknown };
          } catch (err) {
            return { ok: false, message: err instanceof Error ? err.message : "Not valid JSON" };
          }
        })();
  const local = candidate.ok ? validateConfig(candidate.value) : [];
  const issues = failure?.issues.length ? failure.issues : local;
  const at = (path: string) => issuesAt(issues, path);

  const edit = (next: SiteConfig) => {
    setDraft(next);
    setReview(null);
    setFailure(null);
  };
  const set = <K extends keyof SiteConfig>(key: K, value: SiteConfig[K]) => edit({ ...draft, [key]: value });

  const toJson = () => {
    setJson(`${JSON.stringify(draft, null, 2)}\n`);
    setMode("json");
  };
  const toForm = () => {
    if (!candidate.ok) return;
    const r = SiteConfig.safeParse(candidate.value);
    if (!r.success) return;
    edit(r.data);
    setMode("form");
  };

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await work();
    } catch (err) {
      setFailure(describeFailure(err));
    } finally {
      setBusy(false);
    }
  };
  const doReview = () =>
    run(async () => {
      if (!candidate.ok) return;
      const r = await importConfig(site, JSON.stringify(candidate.value, null, 2), true);
      if (!r.valid)
        setFailure({ message: "The server rejected this config.", issues: r.issues, conflictVersion: null });
      else setReview(r.diff);
    });
  const doSave = () =>
    run(async () => {
      if (!candidate.ok) return;
      await saveConfig(site, candidate.value, state.version, note.trim());
      onReload();
    });

  const known = new Map(services.map((s) => [s.id, s.name]));
  for (const id of draft.sections.flatMap((s) => s.services)) if (!known.has(id)) known.set(id, id);
  const themes = registeredThemes();
  // A maintenance window can cover any service: the known ones plus every monitor's, saved or not.
  const coverable = new Map(known);
  for (const m of monitorsOf(draft)) {
    const id = monitorServiceId(m.id);
    if (!coverable.has(id)) coverable.set(id, m.name);
  }
  for (const id of draft.maintenance.flatMap((w) => w.services))
    if (!coverable.has(id)) coverable.set(id, id);

  return (
    <Card
      title="Config"
      aside={
        <div role="tablist" aria-label="Editor" className="flex gap-1">
          <Button
            role="tab"
            aria-selected={mode === "form"}
            onClick={toForm}
            disabled={mode === "form" || local.length > 0 || !candidate.ok}
          >
            Form
          </Button>
          <Button role="tab" aria-selected={mode === "json"} onClick={toJson} disabled={mode === "json"}>
            JSON
          </Button>
        </div>
      }
    >
      {failure?.conflictVersion != null && (
        <Notice tone="warn" className="mb-4">
          Someone saved version {failure.conflictVersion} while you were editing (you started from version{" "}
          {state.version}).{" "}
          <Button onClick={onReload} className="ml-1">
            Reload version {failure.conflictVersion}
          </Button>
          <span className="mt-1 block text-xs text-muted">Reloading drops the edits made here.</span>
        </Notice>
      )}
      {failure && failure.conflictVersion == null && (
        <Notice tone="error" className="mb-4">
          {failure.message}
        </Notice>
      )}

      {mode === "json" ? (
        <div>
          <label htmlFor="config-json" className="block text-xs text-muted">
            sites/{state.config.slug}.json
          </label>
          <textarea
            id="config-json"
            value={json}
            spellCheck={false}
            onChange={(e) => {
              setJson(e.target.value);
              setReview(null);
              setFailure(null);
            }}
            rows={24}
            className={`${inputClass} mt-1 font-mono text-xs`}
          />
          {!candidate.ok && <p className="mt-1 text-xs text-down">JSON: {candidate.message}</p>}
          {issues.length > 0 && (
            <ul aria-label="Issues" className="mt-2 text-xs text-down">
              {issues.map((i) => (
                <li key={i.path + i.message}>
                  <span className="font-mono">{i.path || "(root)"}</span>: {i.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">Site</legend>
            <Field
              label="Name"
              value={draft.name}
              issues={at("name")}
              onChange={(e) => set("name", e.target.value)}
            />
            <SelectField
              label="Theme"
              value={draft.theme}
              onChange={(e) => set("theme", e.target.value as SiteConfig["theme"])}
            >
              {themes.map((t) => (
                <option key={t.module.id} value={t.module.id}>
                  {t.module.label} ({t.module.id})
                </option>
              ))}
              {!themes.some((t) => t.module.id === draft.theme) && (
                <option value={draft.theme}>{draft.theme} (not registered)</option>
              )}
            </SelectField>
            <SelectField
              label="Visibility"
              value={draft.visibility}
              aria-describedby="visibility-help"
              onChange={(e) => set("visibility", e.target.value as SiteConfig["visibility"])}
            >
              {VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </SelectField>
            <p id="visibility-help" className="self-end text-xs text-muted">
              {VISIBILITY_HELP[draft.visibility]}
            </p>
            <Field
              label="Branding title"
              value={draft.branding.title}
              issues={at("branding.title")}
              onChange={(e) => set("branding", { ...draft.branding, title: e.target.value })}
            />
            <Field
              label="Tagline"
              value={draft.branding.tagline ?? ""}
              issues={at("branding.tagline")}
              onChange={(e) => set("branding", { ...draft.branding, tagline: e.target.value || undefined })}
            />
          </fieldset>

          <ProfilesField
            value={draft.profiles}
            issues={at("profiles")}
            onChange={(profiles) => set("profiles", profiles)}
          />

          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Sections</legend>
            <div className="flex flex-col gap-3">
              {draft.sections.map((sec, i) => {
                const update = (next: Partial<SiteConfig["sections"][number]>) =>
                  set(
                    "sections",
                    draft.sections.map((s, j) => (j === i ? { ...s, ...next } : s)),
                  );
                return (
                  <div
                    key={i}
                    className="border border-line p-3"
                    aria-label={`Section ${sec.title || i + 1}`}
                    role="group"
                  >
                    <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                      <Field
                        label="Id"
                        value={sec.id}
                        issues={at(`sections.${i}.id`)}
                        onChange={(e) => update({ id: e.target.value })}
                      />
                      <Field
                        label="Title"
                        value={sec.title}
                        issues={at(`sections.${i}.title`)}
                        onChange={(e) => update({ title: e.target.value })}
                      />
                    </div>
                    <p className="mt-3 text-xs text-muted">Services</p>
                    <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                      {[...known].map(([id, name]) => (
                        <li key={id}>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={sec.services.includes(id)}
                              onChange={(e) =>
                                update({
                                  services: e.target.checked
                                    ? [...sec.services, id]
                                    : sec.services.filter((x) => x !== id),
                                })
                              }
                            />
                            <span className="truncate">{name}</span>
                            <span className="truncate font-mono text-xs text-faint">{id}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <IssueText issues={at(`sections.${i}.services`)} />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button onClick={() => set("sections", move(draft.sections, i, -1))} disabled={i === 0}>
                        Move up
                      </Button>
                      <Button
                        onClick={() => set("sections", move(draft.sections, i, 1))}
                        disabled={i === draft.sections.length - 1}
                      >
                        Move down
                      </Button>
                      <Button
                        tone="danger"
                        onClick={() =>
                          set(
                            "sections",
                            draft.sections.filter((_, j) => j !== i),
                          )
                        }
                      >
                        Remove section
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
            <Button
              className="mt-3"
              onClick={() =>
                set("sections", [
                  ...draft.sections,
                  { id: `section-${draft.sections.length + 1}`, title: "New section", services: [] },
                ])
              }
            >
              Add section
            </Button>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Display names</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {[...known].map(([id]) => (
                <Field
                  key={id}
                  label={id}
                  placeholder="Name from the source"
                  value={draft.displayNames[id] ?? ""}
                  issues={at(`displayNames.${id}`)}
                  onChange={(e) => {
                    const { [id]: _, ...rest } = draft.displayNames;
                    set("displayNames", e.target.value ? { ...rest, [id]: e.target.value } : rest);
                  }}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-semibold">Thresholds</legend>
            {THRESHOLDS.map(([key, label]) => (
              <Field
                key={key}
                label={label}
                type="number"
                inputMode="decimal"
                value={Number.isFinite(draft.thresholds[key]) ? draft.thresholds[key] : ""}
                issues={at(`thresholds.${key}`)}
                onChange={(e) => set("thresholds", { ...draft.thresholds, [key]: e.target.valueAsNumber })}
              />
            ))}
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Links</legend>
            <div className="flex flex-col gap-3">
              {draft.links.map((link, i) => {
                const update = (next: Partial<SiteConfig["links"][number]>) =>
                  set(
                    "links",
                    draft.links.map((l, j) => (j === i ? { ...l, ...next } : l)),
                  );
                return (
                  <div key={i} className="grid items-end gap-2 sm:grid-cols-[12rem_1fr_auto]">
                    <Field
                      label="Label"
                      value={link.label}
                      issues={at(`links.${i}.label`)}
                      onChange={(e) => update({ label: e.target.value })}
                    />
                    <Field
                      label="URL"
                      type="url"
                      value={link.href}
                      issues={at(`links.${i}.href`)}
                      onChange={(e) => update({ href: e.target.value })}
                    />
                    <Button
                      tone="danger"
                      onClick={() =>
                        set(
                          "links",
                          draft.links.filter((_, j) => j !== i),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                );
              })}
            </div>
            <IssueText issues={issues.filter((i) => i.path === "links")} />
            <Button
              className="mt-3"
              disabled={draft.links.length >= 10}
              onClick={() => set("links", [...draft.links, { label: "", href: "https://" }])}
            >
              Add link
            </Button>
          </fieldset>

          <MonitorsField
            monitors={draft.monitors}
            agents={draft.agents}
            legacyProbes={draft.probes.filter((p) => !draft.monitors.some((m) => m.id === p.id)).length}
            at={at}
            onChange={(monitors) => set("monitors", monitors)}
          />

          <AgentsField
            agents={draft.agents}
            monitors={draft.monitors}
            at={at}
            onChange={(agents) => set("agents", agents)}
          />

          <MaintenanceField
            windows={draft.maintenance}
            services={[...coverable]}
            at={at}
            onChange={(maintenance) => set("maintenance", maintenance)}
          />

          <AlertsField notify={draft.notify} onChange={(notify) => set("notify", notify)} />

          <ChannelsField
            site={site}
            notify={draft.notify}
            saved={state.config.notify}
            services={[...known]}
            at={at}
            onChange={(notify) => set("notify", notify)}
          />

          <PublicSettings
            site={draft.slug}
            visibility={draft.visibility}
            hostname={draft.hostnames[0] ?? ""}
            value={draft.public}
            saved={state.config.public}
            services={[...known]}
            issues={at("public")}
            onChange={(value) => set("public", value)}
          />

          {local.length > 0 && (
            <Notice tone="error">
              {local.length === 1 ? "1 field needs attention" : `${local.length} fields need attention`}
              {local.some((i) => !isFormPath(i.path)) && (
                <ul className="mt-1 text-xs">
                  {local
                    .filter((i) => !isFormPath(i.path))
                    .map((i) => (
                      <li key={i.path + i.message}>
                        <span className="font-mono">{i.path}</span>: {i.message} (edit in the JSON tab)
                      </li>
                    ))}
                </ul>
              )}
            </Notice>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3 border-t border-line pt-4">
        {review === null ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button tone="primary" onClick={doReview} disabled={busy || !candidate.ok || local.length > 0}>
              Review changes
            </Button>
            <span className="text-xs text-muted">
              Editing version {state.version}, saved {state.savedAt.slice(0, 16).replace("T", " ")} UTC by{" "}
              {state.savedBy}
            </span>
          </div>
        ) : (
          <>
            <h3 className="text-sm font-semibold">Changes against version {state.version}</h3>
            <DiffTable diff={review} />
            <Field
              label="Note (optional, shown in revisions)"
              value={note}
              maxLength={200}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button tone="primary" onClick={doSave} disabled={busy || review.length === 0}>
                Save as version {state.version + 1}
              </Button>
              <Button onClick={() => setReview(null)}>Keep editing</Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

/** Paths the form has an input for; issues elsewhere are listed for the JSON tab. */
const FORM_PATH =
  /^(name|theme|visibility|profiles(\.|$)|branding\.(title|tagline)|sections\.\d+(\.|$)|displayNames\.|thresholds\.|links(\.|$)|monitors(\.|$)|agents(\.|$)|maintenance(\.|$)|notify\.(discord|channels)(\.|$)|public(\.|$))/;
const isFormPath = (path: string) => FORM_PATH.test(path);

/**
 * The site's profiles from the registry, as checkboxes. Checked profiles run in the order they were
 * checked (the JSON tab reorders them); `generic` is always active. An id the registry does not know stays
 * listed, so it can be seen and removed.
 */
function ProfilesField({
  value,
  issues,
  onChange,
}: {
  value: string[];
  issues: ConfigIssue[];
  onChange: (profiles: string[]) => void;
}) {
  const known = listProfiles();
  const unknown = value.filter((id) => !known.some((p) => p.id === id));
  const rows = [
    ...known.map((p) => ({ id: p.id, name: p.name, detail: p.description, guide: p.producerGuide })),
    ...unknown.map((id) => ({
      id,
      name: id,
      detail: "Not registered in this build: it has no effect.",
      guide: undefined,
    })),
  ];
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Profiles</legend>
      <ul className="flex flex-col gap-2">
        {rows.map((p) => {
          const always = p.id === GENERIC_PROFILE;
          const at = value.indexOf(p.id);
          return (
            <li key={p.id}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={always || at >= 0}
                  disabled={always}
                  onChange={(e) =>
                    onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))
                  }
                />
                <span className="min-w-0">
                  {p.name} <span className="font-mono text-xs text-faint">{p.id}</span>
                  {always && <span className="text-xs text-muted"> (always active)</span>}
                  {at >= 0 && (
                    <span className="text-xs text-muted">
                      {" "}
                      (runs {at + 1} of {value.length})
                    </span>
                  )}
                  <span className="block text-xs text-muted">{p.detail}</span>
                  {p.guide && (
                    <span className="block text-xs text-faint">
                      Producer install guide: <span className="font-mono">{p.guide}</span>
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <IssueText issues={issues} />
    </fieldset>
  );
}

const GENERIC_PROFILE = "generic";
