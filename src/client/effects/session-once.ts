import { useEffect, useState } from "react";

const PREFIX = "uptellis-once:";
// Fallback when sessionStorage is unavailable (private mode, blocked storage): once per page load instead.
const claimed = new Set<string>();

/** Marks `key` as seen for this browser session; true only for the first caller. */
export function claimSessionOnce(key: string): boolean {
  const k = PREFIX + key;
  if (claimed.has(k)) return false;
  claimed.add(k);
  try {
    if (sessionStorage.getItem(k) === "1") return false;
    sessionStorage.setItem(k, "1");
  } catch {
    // Storage blocked: the in-memory set above still limits it to once per page load.
  }
  return true;
}

/**
 * True only the first time `key` is seen in this browser session. False on the server and in the first
 * client render (so hydration matches), then true after mount for the first caller. The claim is kept in
 * state, so StrictMode's double effect run does not flip it back.
 */
export function useSessionOnce(key: string): boolean {
  const [first, setFirst] = useState(false);
  useEffect(() => {
    if (claimSessionOnce(key)) setFirst(true);
  }, [key]);
  return first;
}
