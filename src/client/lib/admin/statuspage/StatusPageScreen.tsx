/**
 * The Status page screen: the structure editor on the left (title, who can see it, theme, sections and
 * their services, public names) over one draft, and the live preview of the real public page on the
 * right. One "Publish changes" saves the draft through the save path; the route asks before leaving
 * with unsaved changes (`onDirtyChange`).
 *
 *   <StatusPageScreen site={site} state={state} view={view} onReload={reload} onDirtyChange={setDirty} />
 *
 * Services are named everywhere (their own name, their public name); an id shows at most in a `title`.
 * Below 1280px the preview moves into a drawer behind a "Preview" button.
 */
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import type { SiteConfig } from "@/shared/config";
import type { ConfigState } from "@/shared/schemas/admin";
import type { SiteView } from "@/shared/view";
import { cx } from "../../../kit/cx";
import { registeredThemes } from "../../../themes";
import { validateConfig } from "../ConfigEditor";
import { Drawer } from "../Drawer";
import { AdminIcon } from "../icons";
import { PageHeader } from "../PageHeader";
import { PublicSettings } from "../PublicEditor";
import { StatePill } from "../StatePill";
import { useToast } from "../Toast";
import { Button, ConfirmDialog, Field, IssueText, inputClass, issuesAt, Notice } from "../ui";
import { useSiteConfig } from "../useSiteConfig";
import {
  addSection,
  addService,
  applyDraft,
  type CatalogEntry,
  catalogOf,
  draftOf,
  entryFor,
  GROUP_LABEL,
  landing,
  moveSection,
  moveService,
  type PageDraft,
  type Place,
  placeOf,
  previewView,
  publicName,
  removeSection,
  removeService,
  renameSection,
  type ServiceGroup,
  sameDraft,
  setPublicName,
  stepTarget,
} from "./draft";
import { PagePreview } from "./Preview";

export const PUBLISH_NOTE = "Updated the status page";

export interface StatusPageScreenProps {
  site: string;
  state: ConfigState;
  view: SiteView | null;
  onReload: () => void;
  /** Told whenever the draft starts or stops differing from what is saved. */
  onDirtyChange?: (dirty: boolean) => void;
}

const placeKey = (p: Place) => `${p.section}:${p.index}`;
const sectionName = (title: string) => title.trim() || "an untitled section";

export function StatusPageScreen({ site, state, view, onReload, onDirtyChange }: StatusPageScreenProps) {
  const toast = useToast();
  const cfg = useSiteConfig({ site, state, onReload });
  const [draft, setDraft] = useState<PageDraft>(() => draftOf(cfg.config));
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const focusNext = useRef<string | null>(null);

  const next = applyDraft(cfg.config, draft);
  const issues = validateConfig(next);
  const at = (path: string) => issuesAt(issues, path);
  const dirty = !sameDraft(draft, draftOf(cfg.config));
  const catalog = useMemo(() => catalogOf(cfg.config, view), [cfg.config, view]);
  const shown = useMemo(() => (view ? previewView(view, draft, catalog) : null), [view, draft, catalog]);
  const offPage = catalog.filter((e) => !placeOf(draft, e.id));

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // Focus follows a moved row's handle (or another element the last edit named).
  useEffect(() => {
    const sel = focusNext.current;
    focusNext.current = null;
    if (sel) document.querySelector<HTMLElement>(sel)?.focus();
  });

  const say = (text: string) => setSaid(text);

  const move = (from: Place, to: Place) => {
    const id = draft.sections[from.section]?.services[from.index];
    if (id === undefined) return;
    const moved = moveService(draft, from, to);
    if (moved === draft) return;
    const sec = moved.sections[to.section]!;
    const at = landing(from, to, sec.services.length);
    setDraft(moved);
    focusNext.current = `[data-handle="${placeKey(at)}"]`;
    say(
      `Moved ${publicName(draft, entryFor(catalog, id))} to position ${at.index + 1} of ${sec.services.length} in ${sectionName(sec.title)}.`,
    );
  };

  const add = (section: number, e: CatalogEntry) => {
    const target = draft.sections[section];
    if (!target) return;
    setDraft(addService(draft, section, e.id));
    say(`Added ${publicName(draft, e)} to ${sectionName(target.title)}.`);
  };

  const quickAdd = (e: CatalogEntry) => {
    // Into the last section; a page with none gets one first.
    const base = draft.sections.length ? draft : addSection(draft, "Services");
    const section = base.sections.length - 1;
    setDraft(addService(base, section, e.id));
    say(`Added ${publicName(draft, e)} to ${sectionName(base.sections[section]!.title)}.`);
  };

  const jumpTo = (id: string) => {
    const place = placeOf(draft, id);
    const off = offPage.findIndex((e) => e.id === id);
    const sel = place
      ? `[data-public-name="${placeKey(place)}"]`
      : off >= 0
        ? `[data-quick-add="${off}"]`
        : null;
    if (!sel) return;
    setPreviewOpen(false);
    // After the drawer (if open) has closed and handed focus back.
    setTimeout(() => document.querySelector<HTMLElement>(sel)?.focus(), 0);
  };

  const publish = async () => {
    setError(null);
    const out = await cfg.save((c) => applyDraft(c, draft), PUBLISH_NOTE);
    // On a conflict the page reloads underneath and the draft stays, so publishing again applies it to the latest.
    if (out.ok) toast("Published the status page");
    else setError(out.message);
  };

  const preview = shown ? (
    <PagePreview view={shown} onPick={jumpTo} />
  ) : (
    <p className="border border-line bg-panel p-4 text-sm text-muted">
      The preview shows once the page has data to show.
    </p>
  );

  return (
    <>
      <PageHeader
        title="Status page"
        subtitle="What visitors see. Changes show in the preview as you make them."
        actions={
          <>
            {dirty && (
              <span data-unsaved className="self-center text-sm text-degraded">
                Unsaved changes
              </span>
            )}
            <Button className="xl:hidden" onClick={() => setPreviewOpen(true)}>
              <AdminIcon name="eye" />
              Preview
            </Button>
            <a
              href="/"
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 border border-line px-3 py-1.5 text-sm text-ink hover:bg-raised"
            >
              View page
            </a>
            <Button
              tone="primary"
              onClick={() => void publish()}
              disabled={!dirty || issues.length > 0 || cfg.saving}
            >
              Publish changes
            </Button>
          </>
        }
      />
      <p role="status" aria-live="polite" className="sr-only" data-announce>
        {said}
      </p>
      {error && (
        <Notice tone="error" className="mb-4">
          {error}
        </Notice>
      )}
      {issues.length > 0 && (
        <p className="mb-4 text-sm text-down">
          {issues.length === 1
            ? "1 field needs attention before publishing."
            : `${issues.length} fields need attention before publishing.`}
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <PageBasics draft={draft} at={at} onChange={setDraft} />
          <ThemePicker value={draft.theme} onChange={(theme) => setDraft({ ...draft, theme })} />
          <section aria-labelledby="sp-structure" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="sp-structure" className="text-[15px] font-semibold text-ink">
                Sections and services
              </h2>
              <span className="text-xs text-muted">
                Drag the handles, or focus one and use the arrow keys.
              </span>
            </div>
            <Sections
              draft={draft}
              catalog={catalog}
              at={at}
              onDraft={setDraft}
              onMove={move}
              onAdd={add}
              onRemoveService={(id) => {
                const e = entryFor(catalog, id);
                setDraft(removeService(draft, id));
                say(`Took ${publicName(draft, e)} out of its section.`);
              }}
              onRemoveSection={setRemoving}
            />
            <div>
              <Button
                onClick={() => {
                  setDraft(addSection(draft));
                  focusNext.current = `[data-section-title="${draft.sections.length}"]`;
                }}
              >
                <AdminIcon name="plus" />
                Add section
              </Button>
            </div>
            <OffPage entries={offPage} draft={draft} onAdd={quickAdd} />
          </section>
          <details className="border border-line bg-panel">
            <summary className="cursor-pointer px-4 py-3 text-[15px] font-semibold text-ink">
              More settings
            </summary>
            <div className="border-t border-line p-4">
              <PublicSettings
                site={next.slug}
                visibility={next.visibility}
                hostname={next.hostnames[0] ?? ""}
                value={draft.public}
                saved={cfg.config.public}
                services={catalog.map((e) => [e.id, publicName(draft, e)] as [string, string])}
                issues={at("public")}
                onChange={(v) => setDraft({ ...draft, public: v })}
              />
            </div>
          </details>
        </div>
        <aside className="hidden xl:block" aria-label="Preview">
          <div className="sticky top-20">{preview}</div>
        </aside>
      </div>
      <Drawer
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Preview"
        description="Your status page with the changes made here."
        wide
      >
        {preview}
      </Drawer>
      <ConfirmDialog
        open={removing !== null}
        title="Delete this section?"
        confirm="Delete section"
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing === null) return;
          const title = draft.sections[removing]?.title ?? "";
          setDraft(removeSection(draft, removing));
          setRemoving(null);
          say(`Deleted section ${sectionName(title)}.`);
        }}
      >
        {removing !== null &&
          `${sectionName(draft.sections[removing]?.title ?? "")} and its place on the page go. Its services stay, under "Not in a section".`}
      </ConfirmDialog>
    </>
  );
}

function PageBasics({
  draft,
  at,
  onChange,
}: {
  draft: PageDraft;
  at: (path: string) => ReturnType<typeof issuesAt>;
  onChange: (d: PageDraft) => void;
}) {
  const name = useId();
  const options: [SiteConfig["visibility"], string, string][] = [
    ["public", "Everyone", "Anyone with the address sees the page."],
    ["private", "Only signed-in users", "People you invite sign in to see it."],
  ];
  return (
    <section className="border border-line bg-panel p-4" aria-labelledby="sp-basics">
      <h2 id="sp-basics" className="mb-3 text-[15px] font-semibold text-ink">
        Page
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Title"
          value={draft.title}
          issues={at("branding.title")}
          onChange={(e) => onChange({ ...draft, title: e.target.value })}
        />
        <fieldset>
          <legend className="text-xs text-muted">Who can see it</legend>
          <div className="mt-1 flex flex-col gap-1.5">
            {options.map(([value, label, help]) => (
              <label key={value} className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name={name}
                  value={value}
                  checked={draft.visibility === value}
                  onChange={() => onChange({ ...draft, visibility: value })}
                  className="mt-1"
                />
                <span>
                  {label}
                  <span className="block text-xs text-muted">{help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}

function ThemePicker({
  value,
  onChange,
}: {
  value: SiteConfig["theme"];
  onChange: (theme: SiteConfig["theme"]) => void;
}) {
  const name = useId();
  const themes = registeredThemes();
  return (
    <section className="border border-line bg-panel p-4" aria-labelledby="sp-theme">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="sp-theme" className="text-[15px] font-semibold text-ink">
          Theme
        </h2>
        <span className="text-xs text-muted">
          {themes.length} built-in looks. The preview switches at once.
        </span>
      </div>
      <fieldset>
        <legend className="sr-only">Theme</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {themes.map((t) => {
            const on = t.module.id === value;
            return (
              <label
                key={t.module.id}
                data-theme-option={t.module.label}
                className={cx(
                  "flex cursor-pointer flex-col gap-1.5 border p-2 text-sm text-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-accent",
                  on ? "border-accent" : "border-line hover:bg-raised",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={t.module.id}
                  checked={on}
                  onChange={() => onChange(t.module.id)}
                  className="sr-only"
                />
                {/* The theme's own tokens, scoped by its data-theme. */}
                <span
                  data-theme={t.module.dataTheme}
                  aria-hidden="true"
                  className="flex h-7 overflow-hidden border border-line"
                >
                  <i className="flex-[3] bg-base" />
                  <i className="flex-[2] bg-panel" />
                  <i className="flex-1 bg-accent" />
                  <i className="flex-1 bg-up" />
                  <i className="flex-1 bg-down" />
                </span>
                <span className="flex items-center justify-between gap-1">
                  {t.module.label}
                  {on && <AdminIcon name="check" />}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}

interface DragState {
  from: Place;
  over: Place | null;
}

function Sections({
  draft,
  catalog,
  at,
  onDraft,
  onMove,
  onAdd,
  onRemoveService,
  onRemoveSection,
}: {
  draft: PageDraft;
  catalog: readonly CatalogEntry[];
  at: (path: string) => ReturnType<typeof issuesAt>;
  onDraft: (d: PageDraft) => void;
  onMove: (from: Place, to: Place) => void;
  onAdd: (section: number, e: CatalogEntry) => void;
  onRemoveService: (id: string) => void;
  onRemoveSection: (i: number) => void;
}) {
  const [drag, setDrag] = useState<DragState | null>(null);

  // Pointer drag: the handle keeps the pointer; the row (or section list) under it is the drop target.
  const overAt = (x: number, y: number): Place | null => {
    const el = document.elementFromPoint?.(x, y);
    const row = el?.closest<HTMLElement>("[data-row]");
    if (row) {
      const [s, i] = row.dataset.row!.split(":").map(Number) as [number, number];
      const r = row.getBoundingClientRect();
      return { section: s, index: y > r.top + r.height / 2 ? i + 1 : i };
    }
    const list = el?.closest<HTMLElement>("[data-section-list]");
    if (list) {
      const s = Number(list.dataset.sectionList);
      return { section: s, index: draft.sections[s]?.services.length ?? 0 };
    }
    return null;
  };
  const handlers = (from: Place) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      setDrag({ from, over: null });
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      if (!drag) return;
      const over = overAt(e.clientX, e.clientY);
      if (placeKey(over ?? { section: -1, index: -1 }) !== placeKey(drag.over ?? { section: -1, index: -1 }))
        setDrag({ ...drag, over });
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      if (!drag) return;
      const over = overAt(e.clientX, e.clientY) ?? drag.over;
      setDrag(null);
      if (over) onMove(drag.from, over);
    },
    onPointerCancel: () => setDrag(null),
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      const to = stepTarget(draft, from, e.key === "ArrowUp" ? -1 : 1);
      if (to) onMove(from, to);
    },
  });

  if (draft.sections.length === 0)
    return (
      <p className="border border-dashed border-line p-4 text-sm text-muted">
        No sections yet: every service shows in one list. Add a section to group them.
      </p>
    );

  return (
    <div className="flex flex-col gap-4">
      {draft.sections.map((sec, si) => (
        <div
          key={`${sec.id}-${si}`}
          role="group"
          aria-label={`Section ${sectionName(sec.title)}`}
          className="border border-line bg-panel"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
            <label className="min-w-40 flex-1">
              <span className="sr-only">Section title</span>
              <input
                data-section-title={si}
                value={sec.title}
                onChange={(e) => onDraft(renameSection(draft, si, e.target.value))}
                aria-invalid={at(`sections.${si}`).length > 0 || undefined}
                className={cx(inputClass, "font-semibold")}
              />
            </label>
            <span className="text-xs text-muted">
              {sec.services.length === 1 ? "1 service" : `${sec.services.length} services`}
            </span>
            <Button
              aria-label={`Move section ${sectionName(sec.title)} up`}
              disabled={si === 0}
              onClick={() => onDraft(moveSection(draft, si, -1))}
            >
              <AdminIcon name="chevron" className="rotate-180" />
            </Button>
            <Button
              aria-label={`Move section ${sectionName(sec.title)} down`}
              disabled={si === draft.sections.length - 1}
              onClick={() => onDraft(moveSection(draft, si, 1))}
            >
              <AdminIcon name="chevron" />
            </Button>
            <Button
              tone="danger"
              aria-label={`Delete section ${sectionName(sec.title)}`}
              onClick={() => onRemoveSection(si)}
            >
              <AdminIcon name="trash" />
            </Button>
          </div>
          <IssueText issues={at(`sections.${si}`)} />
          <ul
            data-section-list={si}
            className={cx(
              "flex flex-col",
              drag?.over?.section === si &&
                drag.over.index === sec.services.length &&
                "border-b-2 border-accent",
            )}
          >
            {sec.services.length === 0 && (
              <li className="px-3 py-3 text-sm text-muted">
                Empty section: the page leaves it out. Search below to add a service, or drag one here.
              </li>
            )}
            {sec.services.map((id, ii) => {
              const e = entryFor(catalog, id);
              const place = { section: si, index: ii };
              const name = publicName(draft, e);
              return (
                <li
                  key={id}
                  data-row={placeKey(place)}
                  className={cx(
                    "flex flex-wrap items-center gap-2 border-t border-line px-3 py-2 first:border-t-0 sm:flex-nowrap",
                    drag?.over?.section === si && drag.over.index === ii && "border-t-2 border-t-accent",
                    drag && placeKey(drag.from) === placeKey(place) && "opacity-50",
                  )}
                >
                  <button
                    type="button"
                    data-handle={placeKey(place)}
                    aria-label={`Move ${name}. Use the up and down arrow keys.`}
                    className="inline-flex size-8 shrink-0 cursor-grab touch-none items-center justify-center text-muted hover:bg-raised hover:text-ink"
                    {...handlers(place)}
                  >
                    <Grip />
                  </button>
                  <span className="flex min-w-0 flex-1 flex-col" title={e.id}>
                    <strong className="truncate text-sm font-medium text-ink">{e.name}</strong>
                    <span className="truncate text-xs text-muted">
                      {e.reported ? (e.detail ?? GROUP_LABEL[e.group]) : "No data yet: shown once it reports"}
                    </span>
                  </span>
                  {e.state && <StatePill state={e.state} />}
                  <label className="w-full sm:w-48">
                    <span className="sr-only">Public name for {e.name}</span>
                    <input
                      data-public-name={placeKey(place)}
                      value={draft.displayNames[id] ?? ""}
                      placeholder={e.name}
                      aria-invalid={at(`displayNames.${id}`).length > 0 || undefined}
                      onChange={(ev) => onDraft(setPublicName(draft, e, ev.target.value))}
                      className={inputClass}
                    />
                  </label>
                  <button
                    type="button"
                    aria-label={`Take ${name} out of ${sectionName(sec.title)}`}
                    onClick={() => onRemoveService(id)}
                    className="inline-flex size-8 shrink-0 items-center justify-center text-muted hover:bg-raised hover:text-down"
                  >
                    <AdminIcon name="x" />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-line p-3">
            <ServicePicker
              section={si}
              sectionTitle={sec.title}
              draft={draft}
              catalog={catalog}
              onAdd={(e) => onAdd(si, e)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Grip() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
      {[6, 12, 18].map((y) => (
        <g key={y}>
          <circle cx="9" cy={y} r="1.6" />
          <circle cx="15" cy={y} r="1.6" />
        </g>
      ))}
    </svg>
  );
}

const GROUPS: ServiceGroup[] = ["monitor", "heartbeat", "other"];

/** "Search monitors to add": a combobox over the catalog by name, grouped by kind. */
function ServicePicker({
  section,
  sectionTitle,
  draft,
  catalog,
  onAdd,
}: {
  section: number;
  sectionTitle: string;
  draft: PageDraft;
  catalog: readonly CatalogEntry[];
  onAdd: (e: CatalogEntry) => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const q = query.trim().toLowerCase();
  const matches = catalog.filter((e) =>
    [e.name, publicName(draft, e), e.detail ?? ""].some((t) => t.toLowerCase().includes(q)),
  );
  const ordered = GROUPS.flatMap((g) => matches.filter((e) => e.group === g));
  const where = (e: CatalogEntry) => {
    const p = placeOf(draft, e.id);
    return p ? draft.sections[p.section]!.title : null;
  };
  const enabled = ordered.map((e) => where(e) === null);
  const step = (by: 1 | -1) => {
    if (!ordered.length) return;
    let i = active;
    for (let n = 0; n < ordered.length; n++) {
      i = (i + by + ordered.length) % ordered.length;
      if (enabled[i]) return setActive(i);
    }
  };
  const choose = (i: number) => {
    const e = ordered[i];
    if (!e || !enabled[i]) return;
    onAdd(e);
    setQuery("");
    setActive(-1);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      step(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" && open && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  };
  const optionId = (i: number) => `${id}-option-${i}`;

  return (
    <div className="relative" data-picker={section}>
      <label className="flex items-center gap-2 border border-line bg-base px-2">
        <AdminIcon name="search" className="text-muted" />
        <span className="sr-only">Search monitors to add to {sectionName(sectionTitle)}</span>
        <input
          type="search"
          role="combobox"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          placeholder="Search monitors to add"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-ink placeholder:text-faint focus:outline-none"
        />
      </label>
      <div
        id={`${id}-list`}
        role="listbox"
        aria-label={`Services to add to ${sectionName(sectionTitle)}`}
        hidden={!open}
        className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto border border-line bg-panel shadow-xl"
      >
        {ordered.length === 0 && (
          <p className="px-3 py-2 text-sm text-muted">
            Nothing matches.{" "}
            <a href="/admin" className="text-accent underline">
              Create a monitor
            </a>
          </p>
        )}
        {GROUPS.map((g) => {
          const items = ordered.flatMap((e, i) => (e.group === g ? [{ e, i }] : []));
          if (!items.length) return null;
          return (
            <div key={g} role="group" aria-label={GROUP_LABEL[g]}>
              <p aria-hidden="true" className="px-3 pt-2 pb-1 text-xs font-semibold text-muted">
                {GROUP_LABEL[g]}
              </p>
              {items.map(({ e, i }) => {
                const placed = where(e);
                return (
                  <div
                    key={e.id}
                    id={optionId(i)}
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === active}
                    aria-disabled={placed !== null || undefined}
                    title={e.id}
                    // Keep focus in the search box while choosing with the pointer.
                    onMouseDown={(ev) => ev.preventDefault()}
                    onClick={() => choose(i)}
                    className={cx(
                      "flex items-center justify-between gap-3 px-3 py-1.5 text-sm",
                      placed === null ? "cursor-pointer text-ink hover:bg-raised" : "text-muted",
                      i === active && "bg-raised",
                    )}
                  >
                    <span className="truncate">{e.name}</span>
                    <span className="shrink-0 text-xs text-muted">
                      {placed !== null ? `On the page in ${sectionName(placed)}` : (e.detail ?? "")}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Services no section lists: the page still shows them, after the sections, without a heading. */
function OffPage({
  entries,
  draft,
  onAdd,
}: {
  entries: readonly CatalogEntry[];
  draft: PageDraft;
  onAdd: (e: CatalogEntry) => void;
}) {
  return (
    <div className="border border-line bg-panel p-4" data-off-page>
      <h3 className="text-sm font-semibold text-ink">Not in a section</h3>
      {entries.length === 0 ? (
        <p className="mt-1 text-xs text-muted">Every service is in a section.</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted">
            The page lists these after the sections, without a heading. Click one to add it to the last
            section.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {entries.map((e, i) => (
              <Button key={e.id} data-quick-add={i} title={e.id} onClick={() => onAdd(e)}>
                <AdminIcon name="plus" />
                {publicName(draft, e)}
                {e.group === "heartbeat" && <span className="text-muted">(heartbeat)</span>}
              </Button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
