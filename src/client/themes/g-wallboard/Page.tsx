import { useRef } from "react";
import type { ThemePageProps } from "../types";
import { Alerts } from "./Alerts";
import { Board } from "./Board";
import { Foot, History } from "./Bottom";
import { alertPlan, SQUEEZE_ROWS } from "./format";
import { Top, Verdict } from "./Top";
import { useSqueeze } from "./useSqueeze";

/**
 * Theme G "Wallboard" (mockups/wallboard): a dark board for a screen across the room. From 900 px it fills
 * one screen without scrolling (sizes in rem off a viewport-scaled root, tokens.css) and rotates the
 * sections that do not fit; below 900 px it stacks into big tiles and the page scrolls. On a wall the
 * service tiles come first: the alert strips are capped, and the recent incidents fold to one line when the
 * alerts or a short screen leave no room for them.
 */
export function Page({ view }: ThemePageProps) {
  const main = useRef<HTMLElement>(null);
  const plan = alertPlan(view);
  const signature = `${plan.rows}|${view.incidents.recent.length}|${view.sections.length}|${view.unsectioned.length}`;
  const squeezed = useSqueeze(main, plan.rows >= SQUEEZE_ROWS, signature);
  return (
    <div className="flex min-h-dvh flex-col gap-[0.9rem] bg-base p-4 font-sans leading-[1.2] font-medium text-ink tabular-nums min-[900px]:h-dvh min-[900px]:gap-[0.8rem] min-[900px]:overflow-hidden min-[900px]:px-6 min-[900px]:pt-4 min-[900px]:pb-[0.8rem]">
      <Top view={view} />
      <main ref={main} className="flex min-h-0 flex-1 flex-col gap-[0.9rem] min-[900px]:gap-[0.8rem]">
        <Verdict view={view} />
        <Alerts view={view} />
        <Board view={view} />
        <History view={view} squeezed={squeezed} />
      </main>
      <Foot view={view} />
    </div>
  );
}
