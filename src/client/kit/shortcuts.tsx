import { createContext, useContext } from "react";

/**
 * Whether a theme may listen for page-wide keyboard shortcuts (j/k between cards and similar). True on the
 * status page itself; the admin's live preview renders a theme inside another page and turns it off, so the
 * preview never captures keys meant for the admin.
 */
export const PageShortcutsContext = createContext(true);

/** True when the theme being rendered may register document-wide keyboard shortcuts. */
export function usePageShortcuts(): boolean {
  return useContext(PageShortcutsContext);
}
