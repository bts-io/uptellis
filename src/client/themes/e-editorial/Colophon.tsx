import type { SiteView } from "@/shared/view";
import { cx } from "./format";
import { AgeText } from "./ui";

const LEGEND = [
  { swatch: "bg-(--e-tick-up)", label: "No problems" },
  { swatch: "bg-(--e-tick-degraded)", label: "Degraded" },
  { swatch: "bg-(--e-tick-down)", label: "Outage" },
  { swatch: "bg-(--e-tick-maintenance)", label: "Maintenance" },
  { swatch: "bg-(--e-tick-none)", label: "No data" },
];

function Head({ children }: { children: string }) {
  return (
    <h2 className="m-0 mt-5 mb-[0.4rem] text-[0.75rem] tracking-[0.12em] text-ink uppercase">{children}</h2>
  );
}

/** Links, where the data comes from, how to read the bars, and the imprint. */
export function Colophon({ view, commit }: { view: SiteView; commit: string | null }) {
  return (
    <footer className="mt-12 border-t-[3px] border-double border-(--e-rule-strong) pt-4 font-sans text-[0.82rem] text-muted">
      {view.links.length > 0 && (
        <>
          <Head>Elsewhere</Head>
          <ul className="m-0 flex list-none flex-wrap gap-x-5 gap-y-[0.4rem] p-0">
            {view.links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="text-ink underline decoration-1 underline-offset-[0.18em] hover:decoration-2"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      <Head>Sources</Head>
      <ul className="m-0 list-none p-0">
        {view.freshness.perSource.map((s) => (
          <li
            key={s.id}
            data-freshness={s.freshness}
            className={cx("py-[0.2rem]", s.freshness === "stale" && "font-semibold text-degraded")}
          >
            {s.id}:{" "}
            {s.ageS === null ? (
              "has not reported"
            ) : (
              <>
                reported <AgeText ageS={s.ageS} now={view.now} />
              </>
            )}{" "}
            ({s.freshness})
          </li>
        ))}
      </ul>
      <Head>How to read the bars</Head>
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-[0.3rem] p-0">
        {LEGEND.map((l) => (
          <li key={l.label} className="inline-flex items-center gap-[0.35rem]">
            <i
              aria-hidden="true"
              className={cx("inline-block h-[0.9rem] w-[0.55rem] rounded-[1px]", l.swatch)}
            />
            {l.label}
          </li>
        ))}
      </ul>
      <p className="mt-5 mb-0">
        {view.site.name} status, published with Uptellis{commit ? `, build ${commit.slice(0, 8)}` : ""}.
      </p>
    </footer>
  );
}
