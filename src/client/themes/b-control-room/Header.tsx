import { useId, useRef } from "react";
import { useAgeTicker, useDecrypt, useMatrixRain, useReducedMotion } from "@/client/effects";
import { StateDot } from "@/client/kit";
import type { DisplayState, SiteView } from "@/shared/view";
import { allServices, cx, fmtAge, isoBefore } from "./format";
import { Wrap } from "./ui";

const TITLE = "[ Services Status ]";

/** Glass sticky bar: mark, gradient title and site name on the left; verdict and freshness on the right. */
export function Header({ view }: { view: SiteView }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  useMatrixRain(canvas, { fps: 12, enabled: !reduced });
  const title = useDecrypt(TITLE, { durationMs: 900 });

  return (
    <header className="sticky top-0 z-30 overflow-hidden border-b border-hair bg-(--b-glass) backdrop-blur-md">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 motion-reduce:hidden">
        <canvas ref={canvas} className="size-full text-frame opacity-[.06]" />
      </div>
      <Wrap className="relative flex flex-wrap items-center gap-x-6 gap-y-3 py-3.5">
        <div className="flex min-w-0 items-center gap-3.5">
          <Mark />
          <div className="min-w-0">
            <h1 className="m-0 w-max font-mono text-[19px] leading-tight font-semibold tracking-[-.01em] whitespace-pre text-gradient-brand min-[1100px]:text-[21px]">
              <span aria-hidden="true">{title}</span>
              <span className="sr-only">{TITLE}</span>
            </h1>
            <div className="mt-0.5 truncate text-xs text-muted">
              {view.branding.tagline ?? view.branding.title}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:ml-auto sm:justify-end">
          <VerdictLine view={view} />
          <Freshness view={view} />
        </div>
      </Wrap>
    </header>
  );
}

/** The site mark: a heartbeat trace in a gradient-ringed square. */
function Mark() {
  const id = useId();
  const stroke = `url(#${id})`;
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true" className="flex-none">
      <defs>
        <linearGradient id={id} x1="0" x2="1">
          <stop offset="0" style={{ stopColor: "var(--b-brand-1)" }} />
          <stop offset="1" style={{ stopColor: "var(--b-brand-2)" }} />
        </linearGradient>
      </defs>
      <rect
        x=".75"
        y=".75"
        width="28.5"
        height="28.5"
        rx="8"
        className="fill-panel"
        stroke={stroke}
        strokeWidth="1.5"
      />
      <path
        d="M6.5 15.5h4l2-5 3.5 9 2.5-6 1.5 2h3.5"
        stroke={stroke}
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "ALL SYSTEMS OPERATIONAL", "PARTIAL OUTAGE: STANDBY POSTGRES" or "STALE · 14M", with its dot. */
function VerdictLine({ view }: { view: SiteView }) {
  const { verdict, freshness } = view;
  const age = useAgeTicker(isoBefore(view.now, freshness.ageS ?? 0), view.now, 15_000);
  const failing = allServices(view).filter((s) => s.state === "down" || s.state === "degraded");
  let label = verdict.label;
  let state: DisplayState = "up";
  if (verdict.state === "stale") {
    label = `stale · ${Math.floor(age / 60)}m`;
    state = "stale";
  } else if (verdict.state === "empty") state = "unknown";
  else if (verdict.state === "outage" || verdict.state === "degraded") {
    state = verdict.state === "outage" ? "down" : "degraded";
    const kind =
      verdict.state === "degraded" ? "degraded" : view.summary.up > 0 ? "partial outage" : "major outage";
    if (failing.length && failing.length <= 2) label = `${kind}: ${failing.map((s) => s.name).join(", ")}`;
  }
  return (
    <p
      role="status"
      data-state={verdict.state}
      className={cx(
        "m-0 flex items-center gap-2 font-mono text-[12.5px] font-semibold tracking-[.08em] whitespace-nowrap uppercase",
        state === "up" ? "text-up" : state === "down" || state === "stale" ? "text-down" : "text-muted",
        state === "degraded" && "text-degraded",
      )}
    >
      <StateDot state={state} label={verdict.state} />
      {label}
    </p>
  );
}

/** "updated 34s ago" pill; the age ticks on the client, amber once aging, red and hollow once stale. */
function Freshness({ view }: { view: SiteView }) {
  const { state, ageS } = view.freshness;
  const age = useAgeTicker(isoBefore(view.now, ageS ?? 0), view.now);
  const bad = state === "stale" || state === "empty";
  return (
    <span
      data-state={state}
      className={cx(
        "inline-flex h-[30px] items-center gap-2 rounded-full border px-[11px] font-mono text-xs whitespace-nowrap",
        bad
          ? "border-down/40 text-down"
          : state === "aging"
            ? "border-degraded/35 text-degraded"
            : "border-hair",
      )}
    >
      <StateDot
        state={state === "fresh" ? "up" : state === "aging" ? "degraded" : "stale"}
        pulse={state === "fresh"}
        label={state}
      />
      {state === "empty" ? "no data yet" : `updated ${fmtAge(age)} ago`}
    </span>
  );
}
