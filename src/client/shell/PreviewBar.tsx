import type { ThemeId } from "@/shared/config";
import type { RegisteredTheme } from "../themes";

export interface PreviewBarProps {
  current: ThemeId;
  siteTheme: ThemeId;
  themes: RegisteredTheme[];
  onPick: (theme: ThemeId) => void;
}

/** Shown only during a `?theme=` preview: which theme this is, a picker, and the way back. */
export function PreviewBar({ current, siteTheme, themes, onPick }: PreviewBarProps) {
  return (
    <div className="fixed bottom-4 left-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-2 border border-line bg-panel px-3 py-2 font-sans text-sm text-ink shadow-lg">
      <label htmlFor="shell-theme" className="text-muted">
        Theme preview
      </label>
      <select
        id="shell-theme"
        value={current}
        onChange={(e) => onPick(e.target.value as ThemeId)}
        className="min-w-0 border border-line bg-base px-2 py-1 text-ink"
      >
        {themes.map((t) => (
          <option key={t.module.id} value={t.module.id}>
            {t.module.label}
            {t.module.id === siteTheme ? " (site)" : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onPick(siteTheme)}
        className="border border-line px-2 py-1 text-ink hover:bg-raised"
      >
        Exit
      </button>
    </div>
  );
}
