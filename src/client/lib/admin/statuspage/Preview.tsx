/**
 * `PagePreview`: the real public page (the chosen theme's `Page`) over the draft's view, drawn at a fixed
 * design width and scaled down to fit its column. The frame carries the theme's `data-theme`, so the
 * theme's tokens apply inside it only.
 *
 *   <PagePreview view={previewView(view, draft, catalog)} onPick={(id) => focusPublicName(id)} />
 *
 * Nothing in the page reacts to the pointer or the keyboard (its links and buttons leave the tab order),
 * except a service: the themes that mark a service (`id="svc-<id>"`) let a click on it call `onPick`
 * with its id, which the editor uses to jump to that service's public name field.
 */
import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { PageShortcutsContext } from "@/client/kit";
import type { SiteView } from "@/shared/view";
import { themeFor } from "../../../themes";

/** The width the page is drawn at before scaling (a laptop screen). */
export const DESIGN_WIDTH = 1280;
const FALLBACK_HEIGHT = 1600;
const SERVICE = '[id^="svc-"]';
const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex]";

export function PagePreview({ view, onPick }: { view: SiteView; onPick?: (serviceId: string) => void }) {
  const theme = themeFor(view.theme);
  const { Page } = theme.module;
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DESIGN_WIDTH * 0.35);
  const [height, setHeight] = useState(FALLBACK_HEIGHT);

  // Follow the column's width and the page's height (no ResizeObserver: keep the first guesses).
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (outer.current?.clientWidth) setWidth(outer.current.clientWidth);
      if (inner.current?.scrollHeight) setHeight(inner.current.scrollHeight);
    });
    if (outer.current) ro.observe(outer.current);
    if (inner.current) ro.observe(inner.current);
    return () => ro.disconnect();
  }, []);

  // The page's own controls stay out of the tab order after every render (a theme may add some).
  useLayoutEffect(() => {
    for (const el of inner.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []) el.tabIndex = -1;
  });

  const scale = Math.min(1, width / DESIGN_WIDTH);
  const pick = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const hit = (e.target as Element | null)?.closest?.(SERVICE);
    if (hit && onPick) onPick(hit.id.slice("svc-".length));
  };

  return (
    <section aria-label="Preview of your status page" className="border border-line bg-panel">
      <div ref={outer} className="overflow-hidden" style={{ height: height * scale }}>
        <div
          ref={inner}
          data-theme={theme.module.dataTheme}
          data-page-preview
          onClickCapture={pick}
          className="origin-top-left bg-base font-sans text-ink"
          style={{ width: DESIGN_WIDTH, transform: `scale(${scale})` }}
        >
          <PageShortcutsContext.Provider value={false}>
            <Page view={view} commit={null} />
          </PageShortcutsContext.Provider>
        </div>
      </div>
    </section>
  );
}
