import { type RefObject, useEffect, useState } from "react";

/** The board fills one screen from this width; below it everything stacks and the page scrolls. */
const WALL = "(min-width: 900px)";

/**
 * Whether the recent-incidents row folds to one line on a wall screen. It folds for sure under `pressure`
 * (the alert rows take its room, known from the data, so the server renders it folded too); otherwise, once
 * mounted, it folds when the full row would push `main` past the screen (the board already at its floor). It
 * measures again after a resize, once the web font is in, and when `signature` changes.
 */
export function useSqueeze(
  main: RefObject<HTMLElement | null>,
  pressure: boolean,
  signature: string,
): boolean {
  const [tight, setTight] = useState(false);

  useEffect(() => {
    if (pressure) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      const box = main.current;
      const history = box?.querySelector<HTMLElement>("[data-g-history]");
      if (!alive || !box || !history) return;
      const wall = typeof matchMedia === "function" && matchMedia(WALL).matches;
      // Lay the full row out, ask whether main overflows, then put back what React rendered.
      const was = history.hasAttribute("data-squeezed");
      history.removeAttribute("data-squeezed");
      const over = box.clientHeight > 0 && box.scrollHeight > box.clientHeight + 2;
      if (was) history.setAttribute("data-squeezed", "");
      setTight(wall && over);
    };
    measure();
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, 200);
    };
    window.addEventListener("resize", onResize);
    document.fonts?.ready.then(measure, () => {});
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, [pressure, signature]);

  return pressure || tight;
}
