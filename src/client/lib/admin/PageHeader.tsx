/**
 * `PageHeader`: the one `h1` of an admin page, a one-line subtitle and the page's main actions (right on a
 * wide screen, under the title on a phone).
 *
 *   <PageHeader title="Monitors" subtitle="Everything we watch for Acme." actions={<Button>New monitor</Button>} />
 */
import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
