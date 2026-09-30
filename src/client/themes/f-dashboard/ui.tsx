import type { HTMLAttributes, ReactNode } from "react";
import type { DisplayState } from "@/shared/view";
import { cx, STATE_LABEL, type Tone, toneOf } from "./format";

/** The mock-up's 16px stroke icons (drawn for this theme; the kit's set has no pulse, wrench or pause). */
const GLYPH = {
  check: <path d="M4.5 8.5l2.3 2.3L11.5 5.8" />,
  x: <path d="M5.2 5.2l5.6 5.6M10.8 5.2l-5.6 5.6" />,
  warn: <path d="M8 4.2v4.6M8 11.4v.4" />,
  question: <path d="M6.2 6.3a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.6-.8 1.2M8 11.5v.3" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="4.2" />
      <path d="M8 5.8V8l1.5 1" />
    </>
  ),
  pause: <path d="M6.3 5v6M9.7 5v6" />,
  wrench: (
    <path d="M10.8 4.2a2.6 2.6 0 0 0-3.2 3.3L4.3 10.8l.9.9 3.3-3.3a2.6 2.6 0 0 0 3.3-3.2l-1.5 1.5-1.2-.3-.3-1.2z" />
  ),
  pulse: <path d="M2.5 8.5h2.3l1.5-3.5 2.5 6 1.6-3.5h3.1" />,
  uptime: <path d="M3 11.5l3-3 2 2 5-5.5M10 5h3v3" />,
  heart: <path d="M8 12.5S3 9.6 3 6.4A2.4 2.4 0 0 1 8 5a2.4 2.4 0 0 1 5 1.4c0 3.2-5 6.1-5 6.1z" />,
  link: (
    <path d="M6.5 9.5l3-3M7 4.8l.9-.9a2.5 2.5 0 0 1 3.5 3.5l-.9.9M9 11.2l-.9.9a2.5 2.5 0 0 1-3.5-3.5l.9-.9" />
  ),
  alert: (
    <>
      <path d="M8 2.8l5.6 9.7H2.4z" />
      <path d="M8 6.8v2.6M8 11.1v.2" />
    </>
  ),
} as const;

export type GlyphName = keyof typeof GLYPH;

/** Decorative icon in the current colour; pair it with text. */
export function Glyph({ name, size = 12 }: { name: GlyphName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {GLYPH[name]}
    </svg>
  );
}

export const STATE_GLYPH: Record<DisplayState, GlyphName> = {
  up: "check",
  degraded: "warn",
  pending: "question",
  down: "x",
  maintenance: "wrench",
  paused: "pause",
  unknown: "question",
  stale: "clock",
};

/** Soft fill and readable text of a tone (pills, tags, the verdict pill). */
export const SOFT: Record<Tone, string> = {
  up: "bg-(--f-up-soft) text-(--f-up-text)",
  degraded: "bg-(--f-degraded-soft) text-(--f-degraded-text)",
  down: "bg-(--f-down-soft) text-(--f-down-text)",
  maint: "bg-(--f-maint-soft) text-(--f-maint-text)",
  stale: "bg-(--f-stale-soft) text-(--f-stale-text)",
};

/** The solid round icon inside a pill. */
export const SOLID: Record<Tone, string> = {
  up: "bg-up text-white",
  degraded: "bg-degraded text-(--f-on-amber)",
  down: "bg-down text-white",
  maint: "bg-maint text-white",
  stale: "bg-stale text-white",
};

export const TONE_TEXT: Record<Tone, string> = {
  up: "text-(--f-up-text)",
  degraded: "text-(--f-degraded-text)",
  down: "text-(--f-down-text)",
  maint: "text-(--f-maint-text)",
  stale: "text-(--f-stale-text)",
};

/** A rounded state word with its icon: `Operational`, `Down`, `Stale`. */
export function Pill({
  tone,
  glyph,
  children,
  className,
}: {
  tone: Tone;
  glyph: GlyphName;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-tone={tone}
      className={cx(
        "inline-flex flex-none items-center gap-[5px] rounded-full py-[3px] pr-[9px] pl-[5px] text-xs font-bold whitespace-nowrap",
        SOFT[tone],
        className,
      )}
    >
      <span className={cx("grid size-4 place-items-center rounded-full", SOLID[tone])}>
        <Glyph name={glyph} size={11} />
      </span>
      {children}
    </span>
  );
}

/** The pill of a service or section state. */
export const StatePill = ({ state }: { state: DisplayState }) => (
  <Pill tone={toneOf(state)} glyph={STATE_GLYPH[state] ?? "question"}>
    {STATE_LABEL[state] ?? state}
  </Pill>
);

/** A soft white card with an 18px radius and a hairline border. */
export function Card({
  as: As = "section",
  className,
  children,
  ...rest
}: {
  as?: "section" | "article" | "div" | "li";
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <As
      {...rest}
      className={cx(
        "min-w-0 rounded-[18px] border border-line bg-panel p-4 shadow-(--f-shadow) sm:p-5",
        className,
      )}
    >
      {children}
    </As>
  );
}

/** Card title on the left, a hint or count on the right. */
export function CardHead({ title, id, hint }: { title: ReactNode; id?: string; hint?: ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-3">
      <h2 id={id} className="m-0 text-[15px] font-bold tracking-[-0.005em]">
        {title}
      </h2>
      {hint !== undefined && <span className="text-[13px] text-muted">{hint}</span>}
    </div>
  );
}

/** Small uppercase label over a figure. */
export const Eyebrow = ({ children }: { children: ReactNode }) => (
  <span className="text-xs font-bold tracking-[0.06em] text-muted uppercase">{children}</span>
);
