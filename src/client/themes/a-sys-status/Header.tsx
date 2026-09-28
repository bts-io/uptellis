import { useRef } from "react";
import { useMatrixRain, useReducedMotion } from "@/client/effects";
import { Banner, FreshnessChip, Verdict } from "@/client/kit";
import { highlightSlots, type SiteView, sourceName } from "@/shared/view";
import { Wrap } from "./Wrap";

/**
 * What the page reads, from the first highlight slot: its label and its group's summary ("kuma 2.5.5 on
 * watch-1"), else its value; without highlights, the collector's name.
 */
function readsFrom(view: SiteView): string | null {
  const [first] = highlightSlots(view.highlights);
  if (!first) {
    const collector = sourceName(view, "kuma");
    return collector && `collector ${collector}`;
  }
  const summary = view.factGroups.find((g) => g.id === first.rows[0].group)?.summary;
  return `${first.label} ${summary ?? first.texts[0]}`;
}

/** Banner, title and subtitle on the left; verdict and freshness on the right; katakana rain behind. */
export function Header({ view }: { view: SiteView }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  useMatrixRain(canvas, { fps: 12, enabled: !reduced });
  const subtitle = [(view.branding.tagline ?? view.site.name).toLowerCase(), readsFrom(view)].filter(Boolean);

  return (
    <header className="relative overflow-hidden border-b border-(--a-line-soft)">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 motion-reduce:hidden">
        <canvas
          ref={canvas}
          className="size-full opacity-[.09] [mask-image:linear-gradient(180deg,#000_40%,transparent_100%)]"
        />
      </div>
      <Wrap className="relative flex items-end justify-between gap-7 pt-[34px] pb-[22px] max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-[18px] max-[760px]:pt-6 max-[760px]:pb-[18px]">
        <div className="flex min-w-0 items-end gap-[26px] max-[760px]:flex-col max-[760px]:items-start max-[760px]:gap-3.5">
          <Banner text={view.site.slug.toUpperCase()} decrypt />
          <div>
            <h1 className="m-0 w-max text-gradient-brand text-[26px] leading-[1.1] font-bold tracking-[-.01em] whitespace-pre max-[760px]:text-[21px]">
              [ Services Status ]
            </h1>
            <p className="mt-2 text-xs text-muted">{subtitle.join(" · ")}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-3 pb-0.5 max-[760px]:w-full max-[760px]:items-start">
          <Verdict verdict={view.verdict} />
          <FreshnessChip freshness={view.freshness} now={view.now} />
        </div>
      </Wrap>
    </header>
  );
}
