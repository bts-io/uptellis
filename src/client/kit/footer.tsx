import { Fragment } from "react";
import { utcTime } from "./format";
import type { FooterProps } from "./props";

const Sep = () => (
  <span aria-hidden="true" className="mx-2 text-faint">
    ·
  </span>
);

/** Real facts only: snapshot time, collector host, build commit and keyboard hints. */
export function Footer({ generatedAt, collectorHost, commit, hints }: FooterProps) {
  const facts = [
    <>
      snapshot <time dateTime={generatedAt}>{utcTime(generatedAt)}</time> UTC
    </>,
    collectorHost && <>collector {collectorHost}</>,
    commit && <>build {commit.slice(0, 7)}</>,
    "times UTC",
  ].filter(Boolean);
  return (
    <footer className="flex flex-col items-start gap-3 border-t border-line/50 pt-[18px] pb-[30px] font-mono text-[11.5px] md:flex-row md:flex-wrap md:items-center md:justify-between md:gap-6">
      <p className="m-0 text-muted md:whitespace-nowrap">
        {facts.map((f, i) => (
          <Fragment key={i}>
            {i > 0 && <Sep />}
            {f}
          </Fragment>
        ))}
      </p>
      {hints && hints.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-2.5 p-0 text-faint md:gap-4">
          {hints.map((h) => (
            <li key={h.keys} className="inline-flex items-center gap-1.5">
              {h.keys.split(/\s+/).map((k) => (
                <kbd
                  key={k}
                  className="border border-b-2 border-ink/12 bg-panel px-1.5 py-px font-mono text-[11px] text-muted"
                >
                  {k}
                </kbd>
              ))}
              <span>{h.label}</span>
            </li>
          ))}
        </ul>
      )}
    </footer>
  );
}
