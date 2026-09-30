import { useAgeTicker } from "@/client/effects";
import type { SiteView, VerdictState } from "@/shared/view";
import { allServices, clock, cx, heroText, isoBefore, niceDate, VERDICT_TONE } from "./format";
import { AgeText, Face, Pill, ToneIcon } from "./ui";

/** The brand: a gradient tile with the name's first letter, the name and the tagline. */
export function Top({ view }: { view: SiteView }) {
  const name = view.branding.title || view.site.name;
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 py-[1.4rem] max-[560px]:py-4">
      <div className="flex min-w-0 items-center gap-[0.7rem]">
        <span
          aria-hidden="true"
          className="grid size-[2.4rem] flex-none place-items-center rounded-xl bg-(image:--gradient-brand) text-[1.2rem] font-extrabold text-(--h-mark-ink)"
        >
          {name.charAt(0)}
        </span>
        <div className="min-w-0">
          <p className="m-0 text-[1.25rem] leading-[1.1] font-extrabold">{name}</p>
          <p className="m-0 text-[0.85rem] text-muted">
            {view.branding.tagline || (name !== view.site.name ? view.site.name : "Service status")}
          </p>
        </div>
      </div>
    </header>
  );
}

const HERO: Record<VerdictState, string> = {
  operational: "border-transparent bg-[linear-gradient(160deg,var(--color-panel)_40%,var(--h-wash-up))]",
  outage: "border-(--h-edge-down) bg-[linear-gradient(160deg,var(--color-panel)_40%,var(--h-wash-down))]",
  degraded: "border-(--h-edge-warn) bg-[linear-gradient(160deg,var(--color-panel)_40%,var(--h-wash-warn))]",
  stale: "border-(--h-edge-idle) bg-[linear-gradient(160deg,var(--color-panel)_40%,var(--h-wash-idle))]",
  empty: "border-(--h-edge-idle) bg-[linear-gradient(160deg,var(--color-panel)_40%,var(--h-wash-idle))]",
};

/** The big card: the face, the verdict pill, a plain heading and sentence, and when we last heard. */
export function Hero({ view }: { view: SiteView }) {
  const name = view.branding.title || view.site.name;
  const { verdict, freshness } = view;
  const age = useAgeTicker(isoBefore(view.now, freshness.ageS ?? 0), view.now, 15_000);
  const text = heroText(view, name, freshness.ageS === null ? null : age);
  return (
    <section
      aria-labelledby="h-hero"
      data-state={verdict.state}
      className={cx(
        "grid grid-cols-[auto_1fr] items-center gap-7 rounded-[32px] border-2 px-9 py-8 shadow-(--h-shadow)",
        "max-[560px]:grid-cols-1 max-[560px]:gap-3 max-[560px]:rounded-[26px] max-[560px]:px-5 max-[560px]:py-6 max-[560px]:text-center",
        HERO[verdict.state],
      )}
    >
      <div className="size-[9.5rem] flex-none max-[560px]:mx-auto max-[560px]:size-[7.5rem]">
        <Face state={verdict.state} />
      </div>
      <div className="min-w-0">
        <Pill tone={VERDICT_TONE[verdict.state]} label={verdict.label} big />
        <h1
          id="h-hero"
          className="mt-[0.6rem] mb-2 text-[clamp(1.8rem,4.5vw,2.6rem)] leading-[1.15] font-extrabold tracking-[-0.01em]"
        >
          {text.h}
        </h1>
        <p className="m-0 text-[1.1rem] text-(--h-ink-2)">{text.p}</p>
        <p className="m-0 mt-[0.9rem] text-[0.92rem] text-muted">
          Last update received <AgeText ageS={freshness.ageS} now={view.now} />
        </p>
      </div>
    </section>
  );
}

/** "Heads up: this page may be out of date", dashed amber, while the data is late (not during site-wide maintenance). */
export function StaleCallout({ view }: { view: SiteView }) {
  const f = view.freshness;
  if (f.state === "fresh" || f.quietForMaintenance) return null;
  const stale = f.state === "stale" || f.state === "empty";
  return (
    <div
      role="status"
      data-freshness={f.state}
      className="mt-5 flex items-start gap-[0.9rem] rounded-[22px] border-2 border-dashed border-(--h-warn-dash) bg-(--h-warn-bg) px-[1.35rem] py-[1.1rem] text-degraded max-[560px]:flex-col max-[560px]:gap-2"
    >
      <ToneIcon tone="warn" className="size-8" />
      <div>
        <h2 className="m-0 mb-[0.2rem] text-[1.1rem] font-extrabold">
          {stale ? "Heads up: this page may be out of date" : "Updates are running a little late"}
        </h2>
        <p className="m-0 text-(--h-warn-ink)">
          {f.state === "empty" ? (
            "We haven't heard from our checks yet."
          ) : (
            <>
              The last update came in <AgeText ageS={f.ageS} now={view.now} />.
            </>
          )}
          {stale
            ? " Until fresh news arrives, every service shows “No recent update” instead of a green light."
            : " Things below may be a few minutes behind."}
        </p>
      </div>
    </div>
  );
}

/** "Planned work: <title>", one soft blue callout per active maintenance window. */
export function MaintenanceCallouts({ view }: { view: SiteView }) {
  const windows = view.maintenance ?? [];
  if (!windows.length) return null;
  const services = allServices(view);
  return (
    <>
      {windows.map((m) => {
        const covered = m.services.length
          ? services
              .filter((s) => m.services.includes(s.id))
              .map((s) => s.name)
              .join(", ") || "some services"
          : "everything";
        return (
          <div
            key={m.id}
            role="status"
            data-maintenance=""
            className="mt-5 flex items-start gap-[0.9rem] rounded-[22px] bg-(--h-maint-bg) px-[1.35rem] py-[1.1rem] text-maint max-[560px]:flex-col max-[560px]:gap-2"
          >
            <ToneIcon tone="maint" className="size-8" />
            <div>
              <h2 className="m-0 mb-[0.2rem] text-[1.1rem] font-extrabold">Planned work: {m.title}</h2>
              <p className="m-0 text-(--h-maint-ink)">
                From {niceDate(m.start)} at {clock(m.start)} until {niceDate(m.end)} at {clock(m.end)}. This
                affects {covered}, so a short pause there is expected.
              </p>
            </div>
          </div>
        );
      })}
    </>
  );
}
