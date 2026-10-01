/**
 * `EmptyState`: what an admin page shows when it has nothing yet: a small inline drawing, a title, one
 * sentence and one button.
 *
 *   <EmptyState
 *     title="Nothing is being watched yet"
 *     text="Add a website or server and we check it every minute."
 *     action={<Button tone="primary" onClick={openNew}>New monitor</Button>}
 *   />
 */
import type { ReactNode } from "react";

export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <section className="flex flex-col items-center gap-3 border border-line bg-panel px-6 py-12 text-center">
      <svg viewBox="0 0 120 120" width="96" height="96" aria-hidden="true" className="text-accent">
        <circle cx="60" cy="60" r="56" fill="currentColor" opacity=".1" />
        <rect x="26" y="34" width="68" height="48" rx="8" fill="none" stroke="currentColor" strokeWidth="4" />
        <path
          d="M36 60h10l6-12 10 22 6-10h16"
          fill="none"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M48 92h24" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      </svg>
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <p className="max-w-prose text-sm text-muted">{text}</p>
      {action}
    </section>
  );
}
