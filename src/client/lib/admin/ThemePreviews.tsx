import { registeredThemes } from "../../themes";
import { Card } from "./ui";

/** Frame size the page renders at, and the scale that fits it into a 358px wide card (a 390px phone). */
const FRAME = { w: 1280, h: 800 };
const SCALE = 0.28;

/** Every registered theme side by side: the live page at `/?theme=<id>`, scaled down in an iframe. */
export function ThemePreviews({ current }: { current: string }) {
  return (
    <Card title="Theme previews">
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(358px,1fr))] gap-4 max-[420px]:grid-cols-1">
        {registeredThemes().map((t) => {
          const href = `/?theme=${t.module.id}`;
          return (
            <li key={t.module.id} className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span>
                  {t.module.label} <span className="font-mono text-xs text-muted">{t.module.id}</span>
                  {t.module.id === current && <span className="ml-2 text-xs text-up">in use</span>}
                </span>
                <a href={href} target="_blank" rel="noopener" className="text-xs text-accent underline">
                  Open
                </a>
              </div>
              <div
                className="relative overflow-hidden border border-line bg-base"
                style={{ width: FRAME.w * SCALE, maxWidth: "100%", height: FRAME.h * SCALE }}
              >
                <iframe
                  src={href}
                  title={`${t.module.label} preview`}
                  loading="lazy"
                  tabIndex={-1}
                  className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
                  style={{ width: FRAME.w, height: FRAME.h, transform: `scale(${SCALE})` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
