import type { ThemePageProps } from "../types";
import { Banner } from "./Banner";
import { Header } from "./Header";
import { OpenIncidents, PastIncidents } from "./Incidents";
import { FreshnessNotice, MaintenanceNotices } from "./Notices";
import { Services } from "./Services";
import { System } from "./System";

/** Theme D "Classic": the hosted status page of mockups/classic over `SiteView`. */
export function Page({ view }: ThemePageProps) {
  const host = view.site.hostnames[0];
  return (
    <div className="min-h-dvh bg-base font-sans text-[15px] leading-normal text-ink antialiased [font-feature-settings:'cv11','ss01'] [&_:focus-visible]:rounded-[3px] [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-2 [&_:focus-visible]:outline-maint">
      <div className="mx-auto max-w-[880px] px-6 pb-12 max-[600px]:px-4 max-[600px]:pb-9">
        <Header view={view} />
        <main>
          <Banner view={view} />
          <FreshnessNotice view={view} />
          <MaintenanceNotices view={view} />
          <OpenIncidents view={view} />
          <Services view={view} />
          <System view={view} />
          <PastIncidents view={view} />
        </main>
        <footer className="mt-11 flex flex-wrap justify-between gap-x-6 gap-y-3 border-t border-(--d-border-strong) pt-5 text-[13px] text-muted">
          <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
            {view.links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="text-(--d-maint-text) no-underline hover:underline focus-visible:underline"
                >
                  {l.label}
                </a>
              </li>
            ))}
            {host && <li>{host}</li>}
          </ul>
          <span>
            Powered by <strong className="font-semibold text-ink">Uptellis</strong>
          </span>
        </footer>
      </div>
    </div>
  );
}
