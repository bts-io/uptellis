import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

export const REFRESH_MS = 30_000;

/**
 * Reloads the current route's data every `everyMs` while the tab is visible. Hidden tabs do not poll; on
 * return a refresh that fell due meanwhile runs at once. The page keeps rendering the previous data while
 * a refresh is in flight, so nothing jumps; ages tick in between from the fresh `view.now` (kit `Age`).
 */
export function useLiveRefresh(everyMs = REFRESH_MS): void {
  const router = useRouter();
  useEffect(() => {
    let last = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = setTimeout(
        () => {
          last = Date.now();
          void router.invalidate();
          schedule();
        },
        Math.max(0, last + everyMs - Date.now()),
      );
    };
    schedule();
    document.addEventListener("visibilitychange", schedule);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [router, everyMs]);
}
