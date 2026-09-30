import type { ReactNode } from "react";
import { useAgeTicker } from "@/client/effects";
import type { DisplayState, VerdictState } from "@/shared/view";
import { ago, cx, isoBefore, TONE, type Tone, WORD } from "./format";

/** Pill fill and text per tone (class names spelled out in full for Tailwind's scanner). */
export const PILL: Record<Tone, string> = {
  up: "bg-(--h-up-bg) text-up",
  warn: "bg-(--h-warn-bg) text-degraded",
  down: "bg-(--h-down-bg) text-down",
  maint: "bg-(--h-maint-bg) text-maint",
  idle: "bg-(--h-idle-bg) text-stale",
};

/** The round icon inside a pill or a callout: a soft disc in the text colour with the tone's mark. */
export function ToneIcon({ tone, className = "size-4" }: { tone: Tone; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={cx("flex-none", className)}>
      <circle cx="10" cy="10" r="9" fill="currentColor" opacity=".18" />
      {tone === "up" && (
        <path
          d="M6 10.5l2.6 2.6L14 7.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {tone === "down" && (
        <path
          d="M7 7l6 6M13 7l-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
      {tone === "warn" && (
        <>
          <path d="M10 5.5v5.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="10" cy="14.2" r="1.3" fill="currentColor" />
        </>
      )}
      {tone === "maint" && (
        <path d="M10 5.5V10l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
      {tone === "idle" && (
        <>
          <circle cx="6.5" cy="10" r="1.3" fill="currentColor" />
          <circle cx="10" cy="10" r="1.3" fill="currentColor" />
          <circle cx="13.5" cy="10" r="1.3" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/** A rounded pill: icon and plain words ("Working", "Not working"). `label` replaces the state's word. */
export function Pill({
  state,
  tone,
  label,
  big,
}: {
  state?: DisplayState;
  tone?: Tone;
  label?: string;
  big?: boolean;
}) {
  const t = tone ?? (state ? TONE[state] : "idle");
  return (
    <span
      data-state={state}
      data-tone={t}
      className={cx(
        "inline-flex items-center gap-[0.4rem] rounded-full leading-[1.3] font-bold whitespace-nowrap",
        big ? "py-[0.35rem] pr-4 pl-3 text-[0.95rem]" : "py-[0.28rem] pr-[0.8rem] pl-[0.6rem] text-[0.85rem]",
        PILL[t],
      )}
    >
      <ToneIcon tone={t} />
      {label ?? (state ? WORD[state] : "")}
    </span>
  );
}

/** "just now", "14 minutes ago", ticking every 15 s on the client from the view's age at `now`. */
export function AgeText({ ageS, now }: { ageS: number | null; now: string }) {
  const s = useAgeTicker(isoBefore(now, ageS ?? 0), now, 15_000);
  return <span>{ago(ageS === null ? null : s)}</span>;
}

/** A white rounded card with the soft warm shadow. */
export const CARD = "rounded-[22px] bg-panel shadow-(--h-shadow)";

/** A block heading: "How everything is doing  8 of 8 working". */
export function BlockHead({ id, children, aside }: { id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <h2 id={id} className="m-0 mb-[0.9rem] text-[1.35rem] font-extrabold">
      {children}
      {aside && <small className="ml-[0.4rem] text-[0.95rem] font-semibold text-muted">{aside}</small>}
    </h2>
  );
}

const FLOAT = "motion-safe:animate-[h-float_4s_ease-in-out_infinite]";
const INK = "#2f2a3b";

/** The soft round buddy whose face tells the story: happy, worried or sleepy. Decorative art, drawn inline. */
export function Face({ state }: { state: VerdictState }) {
  const happy = state === "operational";
  const worried = state === "outage" || state === "degraded";
  const fill = happy ? "#bff0d3" : state === "outage" ? "#ffd1d6" : worried ? "#ffe2bd" : "#dcd7f0";
  const cheek = happy ? "#ffb3c1" : worried ? "#ff9aa8" : "#f4b8c9";
  const label = happy ? "A happy face" : worried ? "A worried face" : "A sleepy face";
  return (
    <svg viewBox="0 0 120 120" role="img" aria-label={label} className="block size-full">
      <ellipse cx="60" cy="108" rx="30" ry="5" fill={INK} opacity=".08" />
      <g className={FLOAT}>
        <circle cx="60" cy="64" r="38" fill={fill} />
        <circle cx="42" cy="68" r="5" fill={cheek} opacity=".7" />
        <circle cx="78" cy="68" r="5" fill={cheek} opacity=".7" />
        {happy ? (
          <>
            <path
              d="M47 58q3-5 6 0M67 58q3-5 6 0"
              fill="none"
              stroke={INK}
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path d="M50 72q10 10 20 0" fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
          </>
        ) : worried ? (
          <>
            <circle cx="50" cy="58" r="3.2" fill={INK} />
            <circle cx="70" cy="58" r="3.2" fill={INK} />
            <path d="M44 49l10 3M76 49l-10 3" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
            <path d="M51 76q9-7 18 0" fill="none" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path
              d="M45 59q5 4 10 0M65 59q5 4 10 0"
              fill="none"
              stroke={INK}
              strokeWidth="3"
              strokeLinecap="round"
            />
            <ellipse cx="60" cy="75" rx="4" ry="3" fill={INK} />
          </>
        )}
      </g>
      {happy && (
        <g fill="#ffd36e">
          <path d="M22 26l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" />
          <path d="M98 18l1.8 4.2 4.2 1.8-4.2 1.8-1.8 4.2-1.8-4.2-4.2-1.8 4.2-1.8z" />
          <path d="M104 88l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z" />
        </g>
      )}
      {worried && (
        <>
          <g transform="translate(86 20) rotate(35)">
            <rect x="-6" y="-14" width="12" height="28" rx="6" fill="#f7c59f" />
            <circle cx="-2" cy="-3" r="1.2" fill="#c98f63" />
            <circle cx="2" cy="3" r="1.2" fill="#c98f63" />
          </g>
          <path d="M88 78c4 4 4 9 0 12-4-3-4-8 0-12z" fill="#8fc7ff" />
        </>
      )}
      {!happy && !worried && (
        <g
          fill="#7a6fb0"
          fontFamily="Nunito, sans-serif"
          fontWeight="800"
          className="motion-safe:animate-[h-zz_2.6s_ease-in-out_infinite]"
        >
          <text x="86" y="34" fontSize="16">
            z
          </text>
          <text x="98" y="22" fontSize="11">
            z
          </text>
        </g>
      )}
    </svg>
  );
}
