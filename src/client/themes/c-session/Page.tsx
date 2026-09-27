import { useState } from "react";
import { useReducedMotion } from "@/client/effects";
import { Footer } from "@/client/kit";
import type { ThemePageProps } from "../types";
import { ActivityBlock } from "./ActivityBlock";
import { BeatsBlock } from "./BeatsBlock";
import { CollectorBlock } from "./CollectorBlock";
import { allServices, DASH, factText, failing, isStale } from "./format";
import { Header } from "./Header";
import { IncidentsBlock } from "./IncidentsBlock";
import { InspectBlock } from "./InspectBlock";
import { SummaryBlock } from "./SummaryBlock";
import { TimelineBlock } from "./TimelineBlock";
import { TopologyBlock } from "./TopologyBlock";
import { useLaneKeys } from "./useLaneKeys";

const HINTS = [
  { keys: "j k", label: "lanes" },
  { keys: "Enter", label: "inspect" },
  { keys: "i", label: "infra" },
];

/** Theme C "Session": mockups/C over `SiteView`, a window of command blocks with plain headers. */
export function Page({ view, commit }: ThemePageProps) {
  useLaneKeys();
  const reduced = useReducedMotion();
  const services = allServices(view);
  // The inspect block opens on the first failing monitor, else the first one; a lane retargets it.
  const initial = services.find((s) => s.state === "down") ?? services.find(failing) ?? services[0];
  const [selected, setSelected] = useState(initial?.id ?? null);
  const inspected = services.find((s) => s.id === selected) ?? initial;
  // A failed fence is the first thing to read, so topology moves above the summary.
  const fenceFirst = view.topology?.fence?.level === "crit";
  const collector = factText(view, "kuma.host");

  const select = (id: string) => {
    setSelected(id);
    document
      .getElementById("inspect")
      ?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  };

  return (
    <div className="min-h-dvh overflow-x-hidden bg-base bg-[linear-gradient(var(--c-grid)_1px,transparent_1px),linear-gradient(90deg,var(--c-grid)_1px,transparent_1px)] bg-size-[24px_24px] font-sans text-sm leading-normal text-ink tabular-nums antialiased selection:bg-accent/25">
      <div className="mx-auto max-w-[1240px] px-2.5 pt-4 pb-8 md:px-6 md:pt-10 md:pb-14">
        <div className="overflow-hidden rounded-xl border border-line bg-(--c-window) shadow-[0_0_0_1px_rgb(0_0_0/0.6),0_30px_80px_-30px_color-mix(in_oklab,var(--color-accent)_8%,transparent),0_40px_120px_-40px_color-mix(in_oklab,var(--color-frame)_10%,transparent)]">
          <Header view={view} />
          <main className={isStale(view) ? "[--color-stale:var(--color-faint)]" : undefined}>
            {isStale(view) && <CollectorBlock view={view} />}
            {fenceFirst && <TopologyBlock view={view} />}
            <SummaryBlock view={view} />
            {!fenceFirst && <TopologyBlock view={view} />}
            <TimelineBlock view={view} selected={inspected?.id ?? null} onSelect={select} />
            {inspected && <InspectBlock view={view} service={inspected} />}
            <BeatsBlock view={view} />
            <ActivityBlock view={view} />
            <IncidentsBlock view={view} />
          </main>
        </div>
        <div className="mt-3.5 px-3 md:px-6">
          <Footer
            generatedAt={view.generatedAt}
            collectorHost={collector === DASH ? null : collector}
            commit={commit}
            hints={HINTS}
          />
        </div>
      </div>
    </div>
  );
}
