import { useAgeTicker } from "@/client/effects";
import type { SiteView, SourceView } from "@/shared/view";
import { ago, cx, dur, LEVEL_TONE, type Tone, when } from "./format";
import { Card, CardHead, Glyph, type GlyphName, Pill, SOFT } from "./ui";

/** The side column: recent incidents, data sources, system facts (the highlights) and links. */
export function Aside({ view }: { view: SiteView }) {
  return (
    <aside
      aria-label="Details"
      className="grid grid-cols-1 gap-4 min-[641px]:grid-cols-[repeat(auto-fit,minmax(280px,1fr))] min-[1181px]:flex min-[1181px]:flex-col"
    >
      <RecentIncidents view={view} />
      <Sources view={view} />
      <Facts view={view} />
      <Links view={view} />
    </aside>
  );
}

function RecentIncidents({ view }: { view: SiteView }) {
  const list = view.incidents.recent;
  return (
    <Card aria-labelledby="f-ri-h">
      <CardHead id="f-ri-h" title="Recent incidents" hint={list.length} />
      {list.length ? (
        <ol className="m-0 list-none p-0">
          {list.map((i) => {
            const resolved = i.endedAt !== null;
            return (
              <li
                key={i.id}
                className="relative pb-4 pl-[22px] before:absolute before:top-[18px] before:bottom-0 before:left-[5px] before:w-0.5 before:bg-line last:pb-0 last:before:hidden"
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "absolute top-1 left-0 size-3 rounded-full border-[3px] border-panel shadow-[0_0_0_1px_var(--color-line)]",
                    resolved ? "bg-up" : "bg-down",
                  )}
                />
                <h3 className="m-0 text-sm font-bold">
                  {i.title}
                  <span
                    className={cx(
                      "ml-1.5 inline-block rounded-full px-[7px] py-px align-[1px] text-[11px] font-bold",
                      SOFT[resolved ? "up" : "down"],
                    )}
                  >
                    {resolved ? "Resolved" : "Ongoing"}
                  </span>
                </h3>
                <p className="m-0 text-[12.5px] text-muted">
                  {when(i.startedAt)} · {resolved ? "lasted" : "for"} {dur(i.durationS)}
                </p>
                {i.notes && <p className="m-0 text-[12.5px] text-muted">{i.notes}</p>}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="m-0 text-[13.5px] text-muted">No incidents in the recent history.</p>
      )}
    </Card>
  );
}

const SOURCE: Record<SourceView["freshness"], { tone: Tone; glyph: GlyphName; label: string }> = {
  fresh: { tone: "up", glyph: "check", label: "Fresh" },
  aging: { tone: "degraded", glyph: "warn", label: "Aging" },
  stale: { tone: "down", glyph: "clock", label: "Stale" },
  empty: { tone: "stale", glyph: "question", label: "No reports" },
};

function Sources({ view }: { view: SiteView }) {
  const list = view.freshness.perSource;
  return (
    <Card aria-labelledby="f-src-h">
      <CardHead id="f-src-h" title="Data sources" hint={list.length} />
      <ul className="m-0 list-none p-0">
        {list.map((s) => (
          <SourceRow key={s.id} source={s} now={view.now} />
        ))}
      </ul>
    </Card>
  );
}

function SourceRow({ source: s, now }: { source: SourceView; now: string }) {
  const age = useAgeTicker(s.lastSeenAt ?? now, now, 15_000);
  const m = SOURCE[s.freshness] ?? SOURCE.empty;
  return (
    <li
      data-source={s.freshness}
      className="flex items-center justify-between gap-2.5 border-t border-hair py-2.5 first:border-t-0 first:pt-0"
    >
      <div className="min-w-0">
        <p className="m-0 text-[13.5px] font-semibold [overflow-wrap:anywhere]">{s.id}</p>
        <p className="m-0 text-xs text-muted">
          {s.kind} · {s.lastSeenAt === null ? "never reported" : `last seen ${ago(age)}`}
        </p>
      </div>
      <Pill tone={m.tone} glyph={m.glyph}>
        {m.label}
      </Pill>
    </li>
  );
}

/** The profiles' highlights as key and value rows, each with its note as a small badge. */
function Facts({ view }: { view: SiteView }) {
  if (!view.highlights.length) return null;
  return (
    <Card aria-labelledby="f-facts-h">
      <CardHead id="f-facts-h" title="System facts" />
      <ul className="m-0 list-none p-0">
        {view.highlights.map((h) => (
          <li
            key={`${h.row.group}.${h.row.key}`}
            className="flex justify-between gap-3 border-t border-hair py-2 text-[13.5px] first:border-t-0 first:pt-0"
          >
            <span className="text-muted">{h.row.label || h.label}</span>
            <span className="text-right font-bold [overflow-wrap:anywhere]">
              {h.prefix ? `${h.prefix} ` : ""}
              {h.row.display}
              {h.note && (
                <span
                  data-level={h.note.level}
                  className={cx(
                    "ml-1.5 inline-block rounded-full px-1.5 py-px text-[10.5px] font-bold",
                    SOFT[LEVEL_TONE[h.note.level]],
                  )}
                >
                  {h.note.text}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Links({ view }: { view: SiteView }) {
  const list = [...view.links, ...view.site.hostnames.map((h) => ({ label: h, href: `https://${h}` }))];
  if (!list.length) return null;
  return (
    <Card aria-labelledby="f-links-h">
      <CardHead id="f-links-h" title="Links" />
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {list.map((l) => (
          <li key={`${l.label}-${l.href}`}>
            <a
              href={l.href}
              rel="noopener"
              className="flex items-center justify-between gap-2 text-sm font-semibold [overflow-wrap:anywhere] text-accent no-underline hover:underline"
            >
              {l.label}
              <Glyph name="link" size={14} />
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}
