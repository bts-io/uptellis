import { type RefObject, useCallback, useEffect, useState } from "react";
import { useReducedMotion, useVisibilityPause } from "@/client/effects";
import { PAGE_MS, paginate, startPage } from "./format";

/** The board fills one screen from this width; below it the groups stack and the page scrolls. */
const WALL = "(min-width: 900px)";

export interface Paging {
  /** Groups per page (indices), or null while everything shows: server render, phone, or all fits. */
  pages: number[][] | null;
  page: number;
  /** Bumps on every turn, so the progress bar restarts. */
  turn: number;
  /** The rotation runs (more than one page, motion allowed, tab visible). */
  running: boolean;
  go: (delta: number) => void;
}

/**
 * Pages the board's groups on a wall screen: once mounted, it measures which groups fit the grid (the
 * `[data-g-group]` children of `grid`), starts on the page with the worst group and turns every PAGE_MS.
 * It measures again after a resize or a change in the grid's height (the recent incidents folding), once the
 * web font is in, and when `signature` (the groups and their states) changes. Nothing here runs on the
 * server, which renders every group in order: the grid clips them to the first page.
 */
export function usePaging(grid: RefObject<HTMLElement | null>, ranks: number[], signature: string): Paging {
  const reduced = useReducedMotion();
  const visible = useVisibilityPause();
  const [pages, setPages] = useState<number[][] | null>(null);
  const [page, setPage] = useState(0);
  const [turn, setTurn] = useState(0);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let height = -1;
    const measure = () => {
      const box = grid.current;
      if (!alive || !box) return;
      height = box.clientHeight;
      const items = [...box.children].filter((el): el is HTMLElement => el.hasAttribute("data-g-group"));
      const wall = typeof matchMedia === "function" && matchMedia(WALL).matches;
      // Show a set, ask whether the grid overflows, then put back what React rendered.
      const was = items.map((el) => el.hidden);
      const fits = (set: number[]) => {
        items.forEach((el, i) => {
          el.hidden = !set.includes(i);
        });
        return box.scrollHeight <= box.clientHeight + 2;
      };
      const next = wall && box.clientHeight > 0 ? paginate(items.length, fits) : null;
      items.forEach((el, i) => {
        el.hidden = was[i]!;
      });
      const paged = next && next.length > 1 ? next : null;
      setPages(paged);
      setPage(paged ? startPage(paged, ranks) : 0);
      setTurn((t) => t + 1);
    };
    measure();
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, 200);
    };
    window.addEventListener("resize", onResize);
    document.fonts?.ready.then(measure, () => {});
    // The grid also changes height without a resize: the alerts or the recent incidents fold or unfold.
    const box = grid.current;
    const observer =
      typeof ResizeObserver === "function" && box
        ? new ResizeObserver(() => {
            if (box.clientHeight !== height) onResize();
          })
        : null;
    if (box) observer?.observe(box);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
      observer?.disconnect();
    };
  }, [signature]);

  const count = pages?.length ?? 1;
  const running = !!pages && !reduced && visible;

  // One timeout per turn: a manual turn (or a new measure) restarts the full PAGE_MS.
  useEffect(() => {
    if (!running) return;
    const id = setTimeout(() => {
      setPage((p) => (p + 1) % count);
      setTurn((t) => t + 1);
    }, PAGE_MS);
    return () => clearTimeout(id);
  }, [running, count, turn]);

  const go = useCallback(
    (delta: number) => {
      setPage((p) => (p + delta + count) % count);
      setTurn((t) => t + 1);
    },
    [count],
  );

  return { pages, page: Math.min(page, count - 1), turn, running, go };
}
