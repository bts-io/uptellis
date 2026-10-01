import { useEffect } from "react";
import { useReducedMotion } from "@/client/effects";
import { usePageShortcuts } from "@/client/kit";

/** j/k move focus between service cards, i jumps to the infra panel (Enter on a card is handled by the card). */
export function useCardKeys() {
  const reduced = useReducedMotion();
  const enabled = usePageShortcuts();
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const cards = [...document.querySelectorAll<HTMLElement>("[data-a-card]")];
      const i = cards.indexOf(document.activeElement as HTMLElement);
      if (e.key === "j") cards[Math.min(cards.length - 1, i + 1)]?.focus();
      else if (e.key === "k") cards[Math.max(0, i - 1)]?.focus();
      else if (e.key === "i")
        document.getElementById("infra")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, reduced]);
}
