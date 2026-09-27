import { useEffect } from "react";
import type { ThemeId } from "@/shared/config";

export interface KeyHint {
  keys: string[];
  label: string;
}

/** Keys the shell owns on every theme. Themes keep letters and Enter (j, k, i, Enter in A, B and C). */
export const SHELL_KEYS: KeyHint[] = [
  { keys: ["/"], label: "Command palette" },
  { keys: ["Ctrl K", "Cmd K"], label: "Command palette" },
  { keys: ["?"], label: "This keyboard map" },
  { keys: ["Esc"], label: "Close a dialog" },
];

/** Each theme's own keys, shown in the keyboard map under the shell's. */
export const THEME_KEYS: Partial<Record<ThemeId, KeyHint[]>> = {
  "a-sys-status": [
    { keys: ["j", "k"], label: "Next or previous service card" },
    { keys: ["Enter"], label: "Expand or collapse a card (phones)" },
    { keys: ["i"], label: "Jump to the infra panel" },
  ],
  "b-control-room": [
    { keys: ["j", "k"], label: "Next or previous monitor tile" },
    { keys: ["i"], label: "Jump to the infra tiles" },
  ],
  "c-session": [
    { keys: ["j", "k"], label: "Next or previous timeline lane" },
    { keys: ["Enter"], label: "Inspect the focused lane" },
    { keys: ["i"], label: "Jump to the topology block" },
  ],
};

const typing = (t: EventTarget | null) =>
  t instanceof Element && t.closest("input, textarea, select, [contenteditable]") !== null;

/**
 * `/` and Ctrl/Cmd+K open the palette, `?` the keyboard map. Plain keys are ignored while typing in a
 * field (the palette's own input included), so theme keys and text entry never collide with them.
 */
export function useShellKeys(open: (what: "palette" | "keys") => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open("palette");
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === "/") {
        e.preventDefault();
        open("palette");
      } else if (e.key === "?") {
        e.preventDefault();
        open("keys");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
}
