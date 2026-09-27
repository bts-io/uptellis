import { useState } from "react";
import { EmptyState, Footer, StaleBanner } from "@/client/kit";
import type { ThemePageProps } from "../types";
import { ActivityTile } from "./Activity";
import { cx, DASH, factText, isStale, kumaStale } from "./format";
import { Header } from "./Header";
import { IncidentCalendar } from "./History";
import { IncidentRow } from "./IncidentRow";
import { BackupTile, ForgejoTile, RunnersTile, TailnetTile } from "./InfraTiles";
import { Kpis } from "./Kpis";
import { MonitorTile } from "./MonitorTile";
import { ResponseChart } from "./ResponseChart";
import { Topology } from "./Topology";
import { Wrap } from "./ui";
import { useTileKeys } from "./useTileKeys";

const HINTS = [
  { keys: "j k", label: "move" },
  { keys: "i", label: "infra" },
];

/** Theme B "Control Room": the bento grid of mockups/B over `SiteView`. */
export function Page({ view, commit }: ThemePageProps) {
  useTileKeys();
  const [phoneTab, setPhoneTab] = useState<"activity" | "history">("activity");
  const monitorsStale = kumaStale(view);
  const services = [...view.sections.flatMap((s) => s.services), ...view.unsectioned];
  const collector = factText(view, "kuma.host");

  return (
    <div className="relative min-h-dvh overflow-x-clip bg-base font-sans text-ink tabular-nums antialiased">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[1500px] bg-[linear-gradient(var(--b-grid)_1px,transparent_1px),linear-gradient(90deg,var(--b-grid)_1px,transparent_1px)] bg-size-[32px_32px] bg-position-[-1px_-1px] mask-[radial-gradient(ellipse_80%_60%_at_50%_0%,#000_30%,transparent_100%)]" />
        <div className="absolute -top-[260px] left-1/2 h-[520px] w-[1100px] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--b-glow-a),var(--b-glow-b)_55%,transparent)] blur-[10px]" />
      </div>

      <Header view={view} />

      {isStale(view) && (
        <div className="relative z-20 border-b border-down/35 bg-[repeating-linear-gradient(135deg,var(--b-strip-a)_0_10px,var(--b-strip-b)_10px_20px)] text-(--b-strip-ink) [&_[role=alert]]:border-0 [&_[role=alert]]:bg-transparent [&_[role=alert]]:px-0 [&_[role=alert]]:text-(--b-strip-ink)">
          <Wrap>
            <StaleBanner freshness={view.freshness} now={view.now} generatedAt={view.generatedAt} />
          </Wrap>
        </div>
      )}

      {/* Stale rings in the content read muted; the header and the strip keep the red stale colour. */}
      <main className="relative z-10 [--color-stale:var(--color-muted)]">
        <Wrap className="flex flex-col gap-3 pt-5 pb-10">
          {view.incidents.open.map((incident) => (
            <IncidentRow key={incident.id} view={view} incident={incident} />
          ))}

          <Kpis view={view} />

          <div className="grid grid-cols-1 gap-3 min-[1100px]:grid-cols-12">
            <div className="flex flex-col min-[1100px]:col-span-5">
              <Topology view={view} />
            </div>

            <section
              id="monitors"
              aria-label="Monitors"
              className="grid grid-cols-1 content-start gap-3 md:grid-cols-2 min-[1100px]:col-span-7"
            >
              {services.length ? (
                services.map((s) => (
                  <MonitorTile key={s.id} service={s} stale={monitorsStale} generatedAt={view.generatedAt} />
                ))
              ) : (
                <div className="md:col-span-2">
                  <EmptyState title="No monitors yet" detail="No source has reported." />
                </div>
              )}
            </section>

            <ResponseChart view={view} />

            <section
              aria-label="Services"
              className="grid grid-cols-1 content-start gap-3 min-[1100px]:col-span-4"
            >
              <ForgejoTile view={view} />
              <RunnersTile view={view} />
            </section>

            <BackupTile view={view} />
            <TailnetTile view={view} />

            <div
              role="tablist"
              aria-label="Activity or history"
              className="flex gap-1 rounded-xl border border-hair bg-panel p-1 md:hidden"
            >
              {(["activity", "history"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={phoneTab === t}
                  onClick={() => setPhoneTab(t)}
                  className={cx(
                    "flex-1 rounded-lg py-2 text-[13px] capitalize",
                    phoneTab === t ? "bg-raised text-ink" : "text-muted",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            <IncidentCalendar
              view={view}
              className={cx("min-[1100px]:col-span-4", phoneTab !== "history" && "max-md:hidden")}
            />
            <ActivityTile
              view={view}
              className={cx("min-[1100px]:col-span-12", phoneTab !== "activity" && "max-md:hidden")}
            />
          </div>

          <div className="mt-3">
            <Footer
              generatedAt={view.generatedAt}
              collectorHost={collector === DASH ? null : collector}
              commit={commit}
              hints={HINTS}
            />
          </div>
        </Wrap>
      </main>
    </div>
  );
}
