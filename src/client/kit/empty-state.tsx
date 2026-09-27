import type { EmptyStateProps } from "./props";

/** "Nothing here yet" box with an optional reason. */
export function EmptyState({ title, detail }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-1.5 border border-dashed border-hair px-6 py-10 text-center font-mono">
      <p className="m-0 text-sm font-semibold text-ink">{title}</p>
      {detail && <p className="m-0 max-w-prose text-xs text-muted">{detail}</p>}
    </div>
  );
}
