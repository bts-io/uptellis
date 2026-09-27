import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

const isVisible = () => typeof document === "undefined" || !document.hidden;

/** False while the document is hidden (background tab), so tickers and canvases can pause. True on the server. */
export function useVisibilityPause(): boolean {
  return useSyncExternalStore(subscribe, isVisible, () => true);
}
