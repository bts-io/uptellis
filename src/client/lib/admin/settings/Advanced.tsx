/**
 * Advanced settings: the full config editor (every setting as a form, or the raw JSON), folded under "Edit
 * config as JSON" with a one-line warning, so nobody lands in it by accident.
 */
import type { ConfigState } from "@/shared/schemas/admin";
import type { SiteView } from "@/shared/view";
import { ConfigEditor } from "../ConfigEditor";
import { AdminIcon } from "../icons";
import { viewServices } from "../monitors/model";
import { SettingsSection } from "./Section";

export function AdvancedEditor({
  site,
  state,
  view,
  onReload,
}: {
  site: string;
  state: ConfigState;
  view: SiteView | null;
  onReload: () => void;
}) {
  return (
    <SettingsSection
      title="Advanced"
      subtitle="For people who like files. Everything on the other pages is also here."
    >
      <details className="group border border-line bg-panel" data-advanced>
        <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-ink">
          <span>
            Edit config as JSON{" "}
            <span className="font-normal text-muted">every setting, checked before it is saved</span>
          </span>
          <AdminIcon name="chevron" className="transition-transform group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-4 border-t border-line p-4">
          <p className="flex items-start gap-2 text-sm text-degraded" role="note">
            <AdminIcon name="degraded" className="mt-0.5" />
            Changes here skip the guided pages: a wrong value can hide monitors or stop alerts, so review
            before you save.
          </p>
          <ConfigEditor
            key={state.version}
            site={site}
            state={state}
            services={viewServices(view).map((s) => ({ id: s.id, name: s.name }))}
            onReload={onReload}
          />
        </div>
      </details>
    </SettingsSection>
  );
}
