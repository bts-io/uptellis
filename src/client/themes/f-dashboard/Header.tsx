import { useAgeTicker } from "@/client/effects";
import type { SiteView } from "@/shared/view";
import { ago, cx, initials, isoBefore } from "./format";

/** Logo tile with the site's initials, name and tagline; the freshness chip on the right. */
export function Header({ view }: { view: SiteView }) {
  const host = view.site.hostnames[0] ?? "";
  const title = view.branding.title || view.site.name;
  return (
    <header className="mb-4 flex flex-wrap items-center justify-between gap-4 sm:mb-6">
      <div className="flex min-w-0 items-center gap-3">
        <div
          aria-hidden="true"
          className="grid size-10 flex-none place-items-center rounded-xl bg-[linear-gradient(135deg,var(--color-accent),var(--f-teal))] text-[17px] font-extrabold text-white shadow-(--f-shadow)"
        >
          {initials(title)}
        </div>
        <div className="min-w-0">
          <h1 className="m-0 text-xl leading-tight font-extrabold tracking-[-0.01em]">{view.site.name}</h1>
          <p className="m-0 text-[13px] [overflow-wrap:anywhere] text-muted">
            {view.branding.tagline || (host ? `${host} · System status` : "System status")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Freshness view={view} />
      </div>
    </header>
  );
}

/** "Updated 34 s ago" with a live dot; amber once the data ages, amber text once stale. Ticks every 15 s. */
function Freshness({ view }: { view: SiteView }) {
  const { state, ageS } = view.freshness;
  const age = useAgeTicker(isoBefore(view.now, ageS ?? 0), view.now, 15_000);
  const bad = state === "stale" || state === "empty";
  const warm = bad || state === "aging";
  return (
    <span
      data-freshness={state}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border bg-panel px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap shadow-(--f-shadow)",
        bad
          ? "border-[color-mix(in_srgb,var(--color-degraded)_45%,var(--color-line))] text-(--f-degraded-text)"
          : "border-line text-(--f-text-2)",
      )}
    >
      <span
        aria-hidden="true"
        className={cx("relative size-2 flex-none rounded-full", warm ? "bg-degraded" : "bg-up")}
      >
        <span
          className={cx(
            "absolute -inset-1 rounded-full border-2 opacity-0 motion-safe:animate-kit-ping",
            warm ? "border-degraded" : "border-up",
          )}
        />
      </span>
      {ageS === null ? (
        "No data received yet"
      ) : (
        <span>
          Updated <time dateTime={isoBefore(view.now, ageS)}>{ago(age)}</time>
        </span>
      )}
    </span>
  );
}
