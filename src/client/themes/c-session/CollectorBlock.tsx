import { Age } from "@/client/kit";
import type { SiteView } from "@/shared/view";
import { Block } from "./Block";
import { DASH, factText, hhmmss } from "./format";
import { KeyValues } from "./KeyValues";

/** Only while the data is stale or missing: which source went quiet, since when, and what the page shows. */
export function CollectorBlock({ view }: { view: SiteView }) {
  const { perSource, stalestSourceId } = view.freshness;
  const source = perSource.find((s) => s.id === stalestSourceId) ?? perSource[0];
  const host = factText(view, "kuma.host");
  return (
    <Block
      id="collector"
      title="Collector"
      command="collector --ping"
      aside={<span>as of {hhmmss(view.generatedAt)}</span>}
      exitCode={1}
    >
      <p className="m-0 flex items-baseline gap-3 font-sans text-[17px] leading-[1.35] font-medium tracking-[-0.01em] text-down md:text-xl">
        <span aria-hidden="true" className="font-mono text-[17px]">
          ✗
        </span>
        {source?.lastSeenAt ? (
          <span>
            no report for{" "}
            <em className="font-mono text-[15.5px] not-italic md:text-lg">
              <Age since={source.lastSeenAt} now={view.now} suffix={false} />
            </em>{" "}
            <span className="text-[15px] text-muted">(expected every {source.expectedIntervalS}s)</span>
          </span>
        ) : (
          <span>no source has reported yet</span>
        )}
      </p>
      <KeyValues
        className="mt-3"
        items={[
          { label: "last snapshot", value: `${hhmmss(view.generatedAt)} UTC` },
          { label: "source", value: source?.id ?? DASH },
          {
            label: "collector",
            value: (
              <>
                {host} <span className="text-down">not reporting</span>
              </>
            ),
          },
          { label: "watchdog", value: factText(view, "watchdog.reachable") },
          { label: "showing", value: <span className="text-muted">last known values, hatched to now</span> },
        ]}
      />
    </Block>
  );
}
