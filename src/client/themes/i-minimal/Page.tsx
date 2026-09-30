import type { VerdictState } from "@/shared/view";
import type { ThemePageProps } from "../types";
import { cx, dayTime } from "./format";
import { Ongoing, Past } from "./Incidents";
import { FreshNote, MaintNotes, VerdictNote } from "./Notes";
import { Services } from "./Services";
import { System } from "./System";

const DOT: Record<VerdictState, string> = {
  operational: "bg-up shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-up)_18%,transparent)]",
  degraded: "bg-degraded shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-degraded)_20%,transparent)]",
  outage: "bg-down shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-down)_18%,transparent)]",
  maintenance: "bg-maint shadow-[0_0_0_4px_color-mix(in_srgb,var(--color-maint)_18%,transparent)]",
  stale: "border-2 border-stale bg-transparent",
  empty: "border-2 border-stale bg-transparent",
};

/** Theme I "Minimal": the one-line page of mockups/minimal over `SiteView`. */
export function Page({ view }: ThemePageProps) {
  const name = view.branding.title || view.site.name;
  const host = view.site.hostnames[0];
  return (
    <div className="min-h-dvh bg-base font-sans text-[15px] leading-[1.55] text-ink antialiased [&_:focus-visible]:rounded-[2px] [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-2 [&_:focus-visible]:outline-maint">
      <div className="mx-auto max-w-[600px] px-6 pt-[72px] pb-16 max-[560px]:px-[18px] max-[560px]:pt-10 max-[560px]:pb-11">
        <header className="mb-5 flex items-baseline justify-between gap-4 text-[13px] text-muted">
          <h1 className="m-0 min-w-0 text-[13px] font-semibold tracking-[0.01em] text-ink [overflow-wrap:anywhere]">
            {name}
            {name !== view.site.name && ` ${view.site.name}`}
          </h1>
          <span className="flex-none">
            <time dateTime={view.generatedAt}>{dayTime(view.generatedAt)}</time>
          </span>
        </header>
        <main>
          <section role="status" aria-label="Overall status">
            <p
              data-state={view.verdict.state}
              className="m-0 flex items-center gap-3 text-2xl leading-tight font-semibold tracking-[-0.015em] max-[560px]:text-[21px]"
            >
              <span
                aria-hidden="true"
                className={cx("size-3 flex-none rounded-full", DOT[view.verdict.state])}
              />
              {view.verdict.label}
            </p>
            <VerdictNote view={view} />
            {view.branding.tagline && (
              <p className="mt-2 mb-0 ml-6 text-sm text-muted">{view.branding.tagline}</p>
            )}
          </section>
          <FreshNote view={view} />
          <MaintNotes view={view} />
          <Ongoing view={view} />
          <Services view={view} />
          <System view={view} />
          <Past view={view} />
        </main>
        <footer className="mt-14 flex flex-wrap justify-between gap-x-5 gap-y-2 text-[12.5px] text-faint">
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0">
            {view.links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="text-inherit underline decoration-(--color-line) underline-offset-[3px] hover:decoration-current focus-visible:decoration-current"
                >
                  {l.label}
                </a>
              </li>
            ))}
            {host && <li>{host}</li>}
          </ul>
          <span>Uptellis</span>
        </footer>
      </div>
    </div>
  );
}
