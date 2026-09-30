import type { SiteView } from "@/shared/view";
import { fmtDayTime } from "./format";

/** Brand mark, site name and tagline on the left; "System status as of <snapshot>" on the right. */
export function Header({ view }: { view: SiteView }) {
  const name = view.branding.title || view.site.name;
  return (
    <header className="flex items-center justify-between gap-4 pt-10 pb-7 max-[600px]:flex-wrap max-[600px]:pt-6 max-[600px]:pb-[18px]">
      <div className="flex min-w-0 items-center gap-3">
        <Mark />
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-bold tracking-[-0.01em] [overflow-wrap:anywhere] max-[600px]:text-[19px]">
            {name}
          </h1>
          {view.branding.tagline && <p className="m-0 text-[13px] text-muted">{view.branding.tagline}</p>}
          {name !== view.site.name && <p className="m-0 text-[13px] text-muted">{view.site.name}</p>}
        </div>
      </div>
      <div className="text-right text-[13px] text-muted max-[600px]:w-full max-[600px]:text-left">
        System status
        <br />
        <strong className="font-medium text-ink">
          as of <time dateTime={view.generatedAt}>{fmtDayTime(view.generatedAt)}</time>
        </strong>
      </div>
    </header>
  );
}

/** The site mark: a heartbeat trace on a dark rounded square. */
function Mark() {
  return (
    <svg viewBox="0 0 36 36" aria-hidden="true" focusable="false" className="size-9 flex-none">
      <rect width="36" height="36" rx="9" className="fill-(--d-mark-bg)" />
      <path
        d="M7 19h5.5l2.8-6.5 4.4 12 3.2-8.5H29"
        fill="none"
        className="stroke-(--d-mark-line)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
