import { highlightedGroups, highlightSlots, type Level, type SiteView } from "@/shared/view";
import type { ThemePageProps } from "../types";
import { clock, cx, duration, MONTHS, niceDate } from "./format";
import { Hero, MaintenanceCallouts, StaleCallout, Top } from "./Hero";
import { Groups, Tech } from "./Services";
import { AgeText, BlockHead, CARD, Pill } from "./ui";

const LEVEL_TEXT: Record<Level, string> = {
  ok: "text-up",
  warn: "text-degraded",
  crit: "text-down",
  info: "text-muted",
};

/** A level's colour, or none once the data is old (old data never reads green). */
const tone = (level: Level | null, old: boolean) => (level && !old ? LEVEL_TEXT[level] : undefined);

/** "What's happening right now": a card per open incident with a red edge. */
function Now({ view }: { view: SiteView }) {
  const open = view.incidents.open;
  if (!open.length) return null;
  return (
    <section id="incidents" className="mt-9" aria-labelledby="h-now">
      <BlockHead id="h-now">What’s happening right now</BlockHead>
      <ul className="m-0 grid list-none gap-[0.9rem] p-0">
        {open.map((i) => {
          const txt =
            i.kind === "stale"
              ? `We stopped hearing from ${i.subject} ${duration(i.durationS)} ago (at ${clock(i.startedAt)}).`
              : `${i.subject} stopped working ${duration(i.durationS)} ago (at ${clock(i.startedAt)}). It still isn't answering, and this page will change as soon as it's back.`;
          return (
            <li
              key={i.id}
              data-incident="open"
              className={cx(CARD, "border-l-8 border-(--h-down-dot) px-[1.4rem] py-[1.2rem]")}
            >
              <Pill state="down" />
              <h3 className="mt-2 mb-1 text-[1.15rem] font-extrabold">{i.title}</h3>
              <p className="m-0 text-(--h-ink-2)">
                {txt}
                {i.notes ? ` ${i.notes}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * "Behind the scenes": the profiles' highlights as friendly chips, then a card per fact group with its
 * summary line and its rows under "Technical details". Not in the mock-up, which predates facts; drawn in
 * the same cards and pills.
 */
function BehindTheScenes({ view }: { view: SiteView }) {
  const slots = highlightSlots(view.highlights);
  const inChips = highlightedGroups(view);
  const groups = view.factGroups.filter((g) => !inChips.has(g.id));
  if (!slots.length && !groups.length) return null;
  const stale = view.freshness.state === "stale" || view.freshness.state === "empty";
  return (
    <section id="infra" className="mt-9" aria-labelledby="h-infra">
      <BlockHead id="h-infra">Behind the scenes</BlockHead>
      {view.headline && <p className="m-0 mb-[0.9rem] -mt-2 text-(--h-ink-2)">{view.headline}.</p>}
      {slots.length > 0 && (
        <ul className="m-0 mb-[1.1rem] flex list-none flex-wrap gap-2 p-0">
          {slots.map((slot) => (
            <li
              key={slot.label}
              className="inline-flex max-w-full flex-wrap items-center gap-x-2 rounded-full bg-panel px-4 py-[0.45rem] text-[0.9rem] shadow-(--h-shadow)"
            >
              <span className="font-bold text-muted">{slot.label}</span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{slot.texts.join(", ")}</span>
              {slot.note && (
                <span
                  className={cx(
                    "rounded-full px-2 text-[0.8rem] font-bold",
                    stale || slot.note.level === "info"
                      ? "bg-(--h-idle-bg) text-stale"
                      : slot.note.level === "ok"
                        ? "bg-(--h-up-bg) text-up"
                        : slot.note.level === "warn"
                          ? "bg-(--h-warn-bg) text-degraded"
                          : "bg-(--h-down-bg) text-down",
                  )}
                >
                  {slot.note.text}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {groups.length > 0 && (
        <div className="grid grid-cols-2 gap-[1.1rem] max-[760px]:grid-cols-1">
          {groups.map((g) => {
            const old = stale || !g.fresh;
            return (
              <section
                key={g.id}
                data-group={g.id}
                aria-labelledby={`h-f-${g.id}`}
                className={cx(CARD, "min-w-0 px-[1.3rem] py-[1.1rem]")}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id={`h-f-${g.id}`} className="m-0 text-[1.1rem] font-extrabold">
                    {g.title}
                  </h3>
                  {!g.fresh && (
                    <span className="text-[0.8rem] font-semibold text-muted">
                      as of {clock(g.observedAt)}
                    </span>
                  )}
                </div>
                {g.summaryParts.length > 0 && (
                  <p className="m-0 mt-1 text-(--h-ink-2) [overflow-wrap:anywhere]">
                    {g.summaryParts.map((p, i) => (
                      <span key={`${i}-${p.text}`}>
                        {i > 0 && " "}
                        <span
                          data-level={p.level ?? undefined}
                          className={cx(tone(p.level, old), p.emphasis && "font-extrabold")}
                        >
                          {p.text}
                        </span>
                      </span>
                    ))}
                  </p>
                )}
                <Tech
                  summary="Technical details"
                  rows={g.rows.map((r) => ({ k: r.label, v: r.display, level: tone(r.level, old) }))}
                />
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** "Earlier hiccups": resolved incidents with a calendar chip, or a calm note. */
function Past({ view }: { view: SiteView }) {
  const recent = view.incidents.recent;
  return (
    <section className="mt-9" aria-labelledby="h-past">
      <BlockHead id="h-past">Earlier hiccups</BlockHead>
      {recent.length ? (
        <ul className={cx(CARD, "m-0 list-none p-0")}>
          {recent.map((i) => {
            const span = `from ${clock(i.startedAt)}${i.endedAt ? ` to ${clock(i.endedAt)}` : ""}`;
            const txt =
              i.kind === "stale"
                ? `We didn't hear from ${i.subject} for ${duration(i.durationS)}, ${span}.`
                : `${i.subject} wasn't working for ${duration(i.durationS)}, ${span}.`;
            return (
              <li
                key={i.id}
                data-incident="resolved"
                className="flex items-start gap-4 border-t-2 border-line px-[1.3rem] py-4 first:border-t-0 max-[560px]:px-4 max-[560px]:py-[0.9rem]"
              >
                <div
                  aria-hidden="true"
                  className="w-[3.6rem] flex-none rounded-[14px] bg-(--h-chip) py-[0.35rem] text-center leading-[1.1]"
                >
                  <b className="block text-[1.3rem] font-extrabold">{Number(i.startedAt.slice(8, 10))}</b>
                  <span className="text-[0.75rem] font-bold text-muted uppercase">
                    {MONTHS[Number(i.startedAt.slice(5, 7)) - 1]!.slice(0, 3)}
                  </span>
                </div>
                <div className="min-w-0">
                  {i.endedAt ? <Pill state="up" label="Fixed" /> : <Pill state="down" />}
                  <p className="m-0 mt-[0.35rem] text-(--h-ink-2)">
                    <strong>{niceDate(i.startedAt)}:</strong> {txt}
                    {i.notes ? ` ${i.notes}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={cx(CARD, "m-0 px-[1.4rem] py-[1.2rem] text-(--h-ink-2)")}>
          No hiccups lately. Everything has been calm.
        </p>
      )}
    </section>
  );
}

/** Helpful links as pills, where the updates come from, and the imprint. */
function Foot({ view, commit }: { view: SiteView; commit: string | null }) {
  return (
    <footer className="mt-10 text-center text-[0.9rem] text-muted">
      {view.links.length > 0 && (
        <nav aria-label="Helpful links">
          <ul className="m-0 mb-4 flex list-none flex-wrap justify-center gap-2 p-0">
            {view.links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="inline-block rounded-full bg-panel px-4 py-[0.45rem] font-bold text-(--h-accent-ink) no-underline shadow-(--h-shadow)"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <Tech
        className="inline-block text-left"
        summary="Where our updates come from"
        rows={view.freshness.perSource.map((s) => ({
          k: s.id,
          v: (
            <>
              {s.ageS === null ? (
                "hasn't reported yet"
              ) : (
                <>
                  reported <AgeText ageS={s.ageS} now={view.now} />
                </>
              )}{" "}
              ({s.freshness})
            </>
          ),
          level: s.freshness === "stale" ? "font-bold text-degraded" : undefined,
        }))}
      />
      <p className="my-1">
        {view.site.name} status page, made with Uptellis{commit ? ` (build ${commit.slice(0, 8)})` : ""}.
      </p>
    </footer>
  );
}

/** Theme H "Friendly": mockups/friendly over `SiteView`, warm and rounded, in plain words. */
export function Page({ view, commit }: ThemePageProps) {
  return (
    <div className="min-h-dvh overflow-x-clip bg-base font-sans text-[1.0625rem] leading-[1.55] text-ink antialiased [&_a:focus-visible]:rounded-lg [&_a:focus-visible]:outline-3 [&_a:focus-visible]:outline-offset-[3px] [&_a:focus-visible]:outline-accent">
      <a
        href="#main"
        className="absolute top-0 -left-[999px] rounded-full bg-ink px-[0.9rem] py-2 text-panel focus:top-2 focus:left-4 focus:z-10"
      >
        Skip to the status
      </a>
      <div className="mx-auto max-w-[62rem] px-5 pb-12 max-[560px]:px-4 max-[560px]:pb-10">
        <Top view={view} />
        <main id="main">
          <Hero view={view} />
          <StaleCallout view={view} />
          <MaintenanceCallouts view={view} />
          <Now view={view} />
          <Groups view={view} />
          <BehindTheScenes view={view} />
          <Past view={view} />
        </main>
        <Foot view={view} commit={commit} />
      </div>
    </div>
  );
}
