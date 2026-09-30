import type { ThemePageProps } from "../types";
import { Colophon } from "./Colophon";
import { plural } from "./format";
import { Lead, MaintenanceNotices, Masthead, StaleNotice } from "./Lead";
import { NewsList } from "./News";
import { Services } from "./Services";
import { Systems } from "./Systems";
import { PartHead } from "./ui";

/** Theme E "Editorial": mockups/editorial over `SiteView`, a status report set like a short article. */
export function Page({ view, commit }: ThemePageProps) {
  const { open, recent } = view.incidents;
  return (
    <div className="min-h-dvh overflow-x-clip bg-base font-(family-name:--e-serif) text-[1.0625rem] leading-[1.6] text-ink antialiased max-[640px]:text-[1rem] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-[3px] [&_a:focus-visible]:outline-ink">
      <a
        href="#story"
        className="absolute top-0 -left-[999px] bg-ink px-3 py-2 text-(--color-base) focus:left-4 focus:z-10"
      >
        Skip to the report
      </a>
      <div className="mx-auto max-w-[44rem] px-5 pb-16 max-[640px]:px-4 max-[640px]:pb-12">
        <Masthead view={view} />

        <main id="story">
          <Lead view={view} />
          <StaleNotice view={view} />
          <MaintenanceNotices view={view} />

          {open.length > 0 && (
            <section id="incidents" className="pt-10" aria-labelledby="e-h-open">
              <PartHead id="e-h-open" title="Developing" aside={plural(open.length, "open incident")} />
              <NewsList incidents={open} open />
            </section>
          )}

          <Services view={view} />
          <Systems view={view} />

          <section className="pt-10" aria-labelledby="e-h-past">
            <PartHead id="e-h-past" title="From the log" aside="recent incidents" />
            {recent.length ? (
              <NewsList incidents={recent} open={false} />
            ) : (
              <p className="m-0 mt-4 text-muted italic">
                Nothing to report. No incidents in the recent record.
              </p>
            )}
          </section>
        </main>

        <Colophon view={view} commit={commit} />
      </div>
    </div>
  );
}
