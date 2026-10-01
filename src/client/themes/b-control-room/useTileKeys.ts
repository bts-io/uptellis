import { useEffect } from "react";
import { useReducedMotion } from "@/client/effects";
import { usePageShortcuts } from "@/client/kit";

/** j/k move focus between monitor tiles, i jumps to the topology tile. */
export function useTileKeys() {
  const reduced = useReducedMotion();
  const enabled = usePageShortcuts();
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const tiles = [...document.querySelectorAll<HTMLElement>("[data-b-card]")];
      const i = tiles.indexOf(document.activeElement as HTMLElement);
      if (e.key === "j") tiles[Math.min(tiles.length - 1, i + 1)]?.focus();
      else if (e.key === "k") tiles[Math.max(0, i - 1)]?.focus();
      else if (e.key === "i")
        document.getElementById("infra")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, reduced]);
}
