import { useEffect } from "react";
import { prefersReducedMotion, useReducedMotion } from "./reduced-motion";
import { useVisibilityPause } from "./visibility";

/** Half-width katakana and digits, as in the terminal rain. */
export const RAIN_GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789";

const FONT_PX = 14;
const COLUMN_PX = FONT_PX * 1.6;

export interface RainColumn {
  /** Head position in rows (negative while above the top edge). */
  y: number;
  speed: number;
  length: number;
  on: boolean;
}

/** One column per 1.6 glyph widths; a little over half of them falling at any time. */
export function rainColumns(width: number, height: number, rand: () => number): RainColumn[] {
  return Array.from({ length: Math.ceil(width / COLUMN_PX) }, () => ({
    y: ((rand() * -height) / FONT_PX) * 2,
    speed: 0.35 + rand() * 0.5,
    length: 6 + Math.floor(rand() * 12),
    on: rand() > 0.45,
  }));
}

/**
 * Draws katakana rain into the canvas at `fps` (default 12) while the tab is visible, the canvas is on
 * screen and motion is allowed. Nothing runs on the server or under reduced motion. The tail colour is the
 * canvas's CSS `color` and the head glyph uses `--color-ink`, so the theme styles it with classes
 * (e.g. `text-accent opacity-10`); the canvas is sized to its CSS box at the device pixel ratio.
 */
export function useMatrixRain(
  canvas: { current: HTMLCanvasElement | null },
  opts: { fps?: number; enabled?: boolean } = {},
): void {
  const { fps = 12, enabled = true } = opts;
  const reduced = useReducedMotion();
  const visible = useVisibilityPause();

  useEffect(() => {
    const el = canvas.current;
    if (!enabled || reduced || !visible || !el || prefersReducedMotion()) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;

    const style = getComputedStyle(el);
    const tail = style.color;
    const head = style.getPropertyValue("--color-ink").trim() || tail;
    const font = `${FONT_PX}px ${style.getPropertyValue("--font-mono").trim() || "monospace"}`;
    let w = 0;
    let h = 0;
    let cols: RainColumn[] = [];
    let onScreen = true;

    const size = () => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      w = r.width;
      h = r.height;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = rainColumns(w, h, Math.random);
    };

    const draw = () => {
      if (!onScreen) return;
      ctx.clearRect(0, 0, w, h);
      ctx.font = font;
      cols.forEach((c, i) => {
        if (!c.on) return;
        const x = i * COLUMN_PX;
        for (let k = 0; k < c.length; k++) {
          const y = (c.y - k) * FONT_PX;
          if (y < -FONT_PX || y > h + FONT_PX) continue;
          ctx.fillStyle = k === 0 ? head : tail;
          ctx.globalAlpha = k === 0 ? 0.95 : (1 - k / c.length) * 0.8;
          ctx.fillText(RAIN_GLYPHS[Math.floor(Math.random() * RAIN_GLYPHS.length)]!, x, y);
        }
        c.y += c.speed;
        if ((c.y - c.length) * FONT_PX > h) {
          c.y = -Math.random() * 8;
          c.on = Math.random() > 0.4;
        }
      });
      ctx.globalAlpha = 1;
    };

    size();
    const resize = new ResizeObserver(size);
    resize.observe(el);
    const io = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
    });
    io.observe(el);
    const timer = setInterval(draw, 1000 / fps);
    return () => {
      clearInterval(timer);
      resize.disconnect();
      io.disconnect();
      ctx.clearRect(0, 0, w, h);
    };
  }, [canvas, enabled, reduced, visible, fps]);
}
