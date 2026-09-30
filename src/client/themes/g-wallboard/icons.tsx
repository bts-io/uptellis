import type { DisplayState, VerdictState } from "@/shared/view";

/** The board's bold state icons on a 32px grid (the mock-up's set), so a state never reads by colour alone. */
const PATHS = {
  up: '<path d="M6 16.5l6.5 6.5L26 9.5" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M8 8l16 16M24 8L8 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>',
  degraded:
    '<path d="M16 4L30 28H2z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M16 12v7" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><circle cx="16" cy="23.5" r="2" fill="currentColor"/>',
  maintenance:
    '<path d="M20 4a7 7 0 0 0-6.6 9.3L4 22.7 9.3 28l9.4-9.4A7 7 0 0 0 28 12l-4 4-5-1-1-5 4-4z" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linejoin="round"/>',
  stale:
    '<circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="3"/><path d="M16 9v7l5 3" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  unknown:
    '<circle cx="16" cy="16" r="12" fill="none" stroke="currentColor" stroke-width="3"/><path d="M12.5 12.5a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.3v.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="23" r="1.8" fill="currentColor"/>',
} as const;

export type IconName = keyof typeof PATHS;

const FOR_STATE: Record<DisplayState, IconName> = {
  up: "up",
  down: "down",
  degraded: "degraded",
  pending: "degraded",
  maintenance: "maintenance",
  stale: "stale",
  paused: "unknown",
  unknown: "unknown",
};

const FOR_VERDICT: Record<VerdictState, IconName> = {
  operational: "up",
  degraded: "degraded",
  outage: "down",
  maintenance: "maintenance",
  stale: "stale",
  empty: "unknown",
};

export const stateIcon = (s: DisplayState) => FOR_STATE[s];
export const verdictIcon = (s: VerdictState) => FOR_VERDICT[s];

/** Decorative: always paired with the state's word. Sized by its class, drawn in the current colour. */
export function BoardIcon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={className ? `shrink-0 ${className}` : "shrink-0"}
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}

/** The site mark: a pulse in a ring. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" strokeWidth="3" />
      <path
        d="M8 17h5l3-7 3 12 3-5h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
