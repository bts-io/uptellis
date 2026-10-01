import { useEffect } from "react";
import { useReducedMotion } from "@/client/effects";
import { usePageShortcuts } from "@/client/kit";

/** j/k move focus between timeline lanes (Enter inspects the focused lane), i jumps to the topology block. */
export function useLaneKeys() {
  const reduced = useReducedMotion();
  const enabled = usePageShortcuts();
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const lanes = [...document.querySelectorAll<HTMLElement>("[data-c-lane]")];
      const i = lanes.indexOf(document.activeElement as HTMLElement);
      if (e.key === "j") lanes[Math.min(lanes.length - 1, i + 1)]?.focus();
      else if (e.key === "k") lanes[Math.max(0, i - 1)]?.focus();
      else if (e.key === "i")
        document.getElementById("infra")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, reduced]);
}
