import type { DisplayState, ServiceView } from "@/shared/view";
import type { ThemePageProps } from "../types";
import { Aside } from "./Aside";
import { MaintenanceBanners, OpenIncidents, StaleNotice } from "./Banners";
import { allServices, when, worstState } from "./format";
import { Header } from "./Header";
import { History } from "./History";
import { Infra } from "./Infra";
import { Overview } from "./Overview";
import { ServiceCard } from "./ServiceCard";
import { StatePill } from "./ui";

/**
 * Theme F "Dashboard" (mockups/dashboard): header and freshness chip; stale, maintenance and incident
 * banners; the verdict donut beside four KPIs; the 90-day uptime chart; service cards by section beside the
 * incidents, sources, facts and links column; the infrastructure facts; the footer.
 */
export function Page({ view, commit }: ThemePageProps) {
  const services = allServices(view);
  return (
    <div className="min-h-dvh bg-base bg-(image:--f-bg-grad) bg-fixed font-sans text-[15px] leading-normal text-ink antialiased">
      <div className="mx-auto w-full max-w-[1320px] px-4 pt-4 pb-8 sm:px-8 sm:pt-6 sm:pb-12">
        <Header view={view} />
        <main>
          <StaleNotice view={view} />
          <MaintenanceBanners view={view} />
          <OpenIncidents view={view} />
          <Overview view={view} services={services} />
          <History services={services} />
          <div className="grid grid-cols-1 items-start gap-6 min-[1181px]:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <h2 className="sr-only">Services</h2>
              {services.length ? (
                <>
                  {view.sections.map((s) => (
                    <Section key={s.id} id={s.id} title={s.title} state={s.state} services={s.services} />
                  ))}
                  <Section
                    id="unsectioned"
                    title="Other services"
                    state={worstState(view.unsectioned)}
                    services={view.unsectioned}
                  />
                </>
              ) : (
                <section className="rounded-[18px] border border-line bg-panel p-5 shadow-(--f-shadow)">
                  <h3 className="m-0 text-[15px] font-bold">No services yet</h3>
                  <p className="m-0 mt-1 text-[13.5px] text-muted">
                    Services show here once a monitoring source reports.
                  </p>
                </section>
              )}
              <Infra view={view} />
            </div>
            <Aside view={view} />
          </div>
        </main>
        <footer className="mt-10 flex flex-wrap justify-between gap-3 border-t border-line pt-5 text-[13px] text-muted">
          <span>
            {view.site.name} · Snapshot <time dateTime={view.generatedAt}>{when(view.generatedAt)}</time>
            {commit ? ` · build ${commit.slice(0, 7)}` : ""}
          </span>
          <span>Powered by Uptellis</span>
        </footer>
      </div>
    </div>
  );
}

function Section({
  id,
  title,
  state,
  services,
}: {
  id: string;
  title: string;
  state: DisplayState;
  services: ServiceView[];
}) {
  if (!services.length) return null;
  const up = services.filter((s) => s.state === "up").length;
  const hid = `f-sec-${id}`;
  return (
    <section aria-labelledby={hid} className="mb-7 last:mb-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id={hid} className="m-0 flex items-center gap-2.5 text-lg font-extrabold tracking-[-0.01em]">
          {title} <StatePill state={state} />
        </h2>
        <span className="text-[13px] font-semibold text-muted">
          {up} of {services.length} operational
        </span>
      </div>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-4 p-0">
        {services.map((s) => (
          <ServiceCard key={s.id} service={s} />
        ))}
      </ul>
    </section>
  );
}
