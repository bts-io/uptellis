import type { ReactNode } from "react";

/**
 * The frame of the pages outside admin (first-run setup, sign-in, invite acceptance): the product name, one
 * narrow panel on the kit tokens, readable at 390px wide.
 */
export function AccountFrame({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center bg-base px-4 py-10 font-sans text-ink sm:py-16">
      <p className="text-gradient-brand font-mono text-sm font-semibold tracking-[.2em] uppercase">
        Uptellis
      </p>
      <main className="mt-6 w-full max-w-md border border-line bg-panel p-5 sm:p-6">
        <h1 className="text-lg font-semibold">{title}</h1>
        {intro && <div className="mt-1 text-sm text-muted">{intro}</div>}
        <div className="mt-5">{children}</div>
      </main>
    </div>
  );
}
