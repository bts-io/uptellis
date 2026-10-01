import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { SiteConfig } from "@/shared/config";
import {
  DisplayNamesField,
  knownServices,
  SectionsField,
  validateConfig,
} from "../../lib/admin/ConfigEditor";
import { viewServices } from "../../lib/admin/monitors/model";
import { PageHeader } from "../../lib/admin/PageHeader";
import { PublicSettings } from "../../lib/admin/PublicEditor";
import { ThemePreviews } from "../../lib/admin/ThemePreviews";
import { useToast } from "../../lib/admin/Toast";
import { Button, Card, issuesAt, Notice, SelectField } from "../../lib/admin/ui";
import { useSiteConfig } from "../../lib/admin/useSiteConfig";
import { registeredThemes } from "../../themes";

const admin = getRouteApi("/admin");

/**
 * Status page (placeholder until its redesign): the sections, display names, theme and public settings
 * parts of the full editor over one draft, saved through the save path, and the theme previews that
 * `/admin/themes` showed.
 */
export const Route = createFileRoute("/admin/status-page")({
  component: StatusPage,
});

type Part = Pick<SiteConfig, "sections" | "displayNames" | "theme" | "public">;
const partOf = (c: SiteConfig): Part => ({
  sections: c.sections,
  displayNames: c.displayNames,
  theme: c.theme,
  public: c.public,
});

function StatusPage() {
  const { site, state, view } = admin.useLoaderData();
  const router = useRouter();
  const toast = useToast();
  const cfg = useSiteConfig({ site, state, onReload: () => void router.invalidate() });
  const [draft, setDraft] = useState<Part>(() => partOf(cfg.config));
  const [error, setError] = useState<string | null>(null);
  const next = { ...cfg.config, ...draft };
  const issues = validateConfig(next);
  const at = (path: string) => issuesAt(issues, path);
  const known = knownServices(
    next,
    viewServices(view).map((s) => ({ id: s.id, name: s.name })),
  );
  const themes = registeredThemes();
  const set = <K extends keyof Part>(key: K, value: Part[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const changed = JSON.stringify(draft) !== JSON.stringify(partOf(cfg.config));

  const save = async () => {
    setError(null);
    const out = await cfg.save((c) => ({ ...c, ...draft }), "Updated the status page");
    // On a conflict the page reloads underneath and the draft stays, so saving again applies it to the latest.
    if (out.ok) toast("Saved the status page");
    else setError(out.message);
  };

  return (
    <>
      <PageHeader
        title="Status page"
        subtitle="What visitors see: sections, names, the theme and what is public."
        actions={
          <a href="/" className="border border-line px-3 py-2 text-sm text-ink hover:bg-raised">
            Open the status page
          </a>
        }
      />
      <div className="flex flex-col gap-6">
        <Card title="Page">
          <div className="flex flex-col gap-6">
            <SelectField
              label="Theme"
              value={draft.theme}
              onChange={(e) => set("theme", e.target.value as SiteConfig["theme"])}
            >
              {themes.map((t) => (
                <option key={t.module.id} value={t.module.id}>
                  {t.module.label}
                </option>
              ))}
            </SelectField>
            <SectionsField
              sections={draft.sections}
              known={known}
              at={at}
              onChange={(v) => set("sections", v)}
            />
            <DisplayNamesField
              displayNames={draft.displayNames}
              known={known}
              at={at}
              onChange={(v) => set("displayNames", v)}
            />
            <PublicSettings
              site={next.slug}
              visibility={next.visibility}
              hostname={next.hostnames[0] ?? ""}
              value={draft.public}
              saved={cfg.config.public}
              services={[...known]}
              issues={at("public")}
              onChange={(v) => set("public", v)}
            />
            {error && <Notice tone="error">{error}</Notice>}
            <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
              <Button
                tone="primary"
                onClick={() => void save()}
                disabled={!changed || issues.length > 0 || cfg.saving}
              >
                Save status page
              </Button>
              {issues.length > 0 && (
                <span className="text-xs text-down">
                  {issues.length === 1 ? "1 field needs attention" : `${issues.length} fields need attention`}
                </span>
              )}
            </div>
          </div>
        </Card>
        <ThemePreviews current={cfg.config.theme} />
      </div>
    </>
  );
}
