/**
 * Settings building blocks: `SettingsSection` is one section's header (an `h2` under the page's `h1`, a
 * one-line subtitle, actions) over its content; `Panel` is a box inside a section with an `h3`.
 *
 *   <SettingsSection title="Revisions" subtitle="Every save is kept.">
 *     <Panel title="History">...</Panel>
 *   </SettingsSection>
 */
import { type ReactNode, useId } from "react";

export function SettingsSection({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-xl font-semibold text-ink">
            {title}
          </h2>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
