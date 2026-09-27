import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Current preference, read directly (false where there is no `matchMedia`, e.g. on the server). */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia(QUERY).matches;
}

function subscribe(onChange: () => void): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const mq = matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True when the user prefers reduced motion; false during SSR and hydration, then the real value. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
