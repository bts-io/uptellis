import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/client/effects";
import type { ThemeId } from "@/shared/config";
import type { SiteView } from "@/shared/view";
import { ApiError, api } from "../lib/api";
import { registeredThemes, themeFor } from "../themes";
import { runAction } from "./actions";
import { CommandPalette } from "./CommandPalette";
import { type PaletteItem, paletteItems } from "./items";
import { KeyMap } from "./KeyMap";
import { SHELL_KEYS, THEME_KEYS, useShellKeys } from "./keys";
import { PreviewBar } from "./PreviewBar";

const TOAST_MS = 2500;

/**
 * Admin is offered only where the admin API answers for this site (no admin cookie: it 404s). Asked once,
 * the first time the palette opens; any other failure still offers the entry, the admin page explains.
 */
function useAdminCheck(slug: string, ask: boolean): boolean {
  const [admin, setAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    if (!ask || admin !== null) return;
    api(`/api/admin/sites/${encodeURIComponent(slug)}/config`).then(
      () => setAdmin(true),
      (err: unknown) => setAdmin(err instanceof ApiError && err.status !== 404),
    );
  }, [ask, admin, slug]);
  return admin === true;
}

export interface ShellProps {
  view: SiteView;
  /** The site's own theme while `view.theme` is a `?theme=` preview. */
  siteTheme: ThemeId | undefined;
  children: ReactNode;
}

/**
 * Chrome shared by every theme, mounted around the theme's Page: the command palette (`/`, Ctrl/Cmd+K),
 * the keyboard map (`?`), the preview bar while `?theme=` is set, and a polite status line for copies.
 */
export function Shell({ view, siteTheme, children }: ShellProps) {
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState<"palette" | "keys" | null>(null);
  const [asked, setAsked] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const admin = useAdminCheck(view.site.slug, asked);

  const show = useCallback((what: "palette" | "keys") => {
    if (what === "palette") setAsked(true);
    setOpen((cur) => cur ?? what);
  }, []);
  useShellKeys(show);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const say = (text: string) => {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), TOAST_MS);
  };
  const go = (href: string) => void navigate({ href });
  // Explicitly unset (not dropped) so the route's retainSearchParams lets the preview go.
  const preview = (theme: ThemeId | null) =>
    void navigate({ to: ".", search: ((prev: object) => ({ ...prev, theme: theme ?? undefined })) as never });
  const run = ({ action }: PaletteItem) => runAction(action, { go, preview, say, reducedMotion: reduced });

  const themes = registeredThemes();
  return (
    <>
      {children}
      {siteTheme && (
        <PreviewBar
          current={view.theme}
          siteTheme={siteTheme}
          themes={themes}
          onPick={(t) => preview(t === siteTheme ? null : t)}
        />
      )}
      <CommandPalette
        open={open === "palette"}
        onClose={() => setOpen(null)}
        items={paletteItems({ view, themes, siteTheme, admin })}
        onRun={run}
      />
      <KeyMap
        open={open === "keys"}
        onClose={() => setOpen(null)}
        shell={SHELL_KEYS}
        theme={THEME_KEYS[themeFor(view.theme).module.id] ?? []}
      />
      <p role="status" aria-live="polite" className="sr-only">
        {toast}
      </p>
      {toast && (
        <div
          aria-hidden="true"
          className="fixed right-4 bottom-4 z-40 border border-line bg-panel px-3 py-2 font-sans text-sm text-ink shadow-lg"
        >
          {toast}
        </div>
      )}
    </>
  );
}
