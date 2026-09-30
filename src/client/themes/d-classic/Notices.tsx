import type { ReactNode } from "react";
import type { SiteView } from "@/shared/view";
import { cx, fmtDayTime, serviceNames } from "./format";
import { LiveAge, StatusIcon } from "./ui";

/** A white card with a thick left rule; `stale` is amber, `maint` blue. */
function Notice({
  tone,
  icon,
  title,
  role,
  data,
  children,
}: {
  tone: "stale" | "maint";
  icon: "clock" | "wrench";
  title: ReactNode;
  role: "alert" | "status";
  data?: Record<string, string>;
  children: ReactNode;
}) {
  return (
    <div
      role={role}
      {...data}
      className={cx(
        "mt-4 flex items-start gap-3 rounded-lg border border-l-4 px-[18px] py-3.5 text-sm",
        tone === "stale"
          ? "border-(--d-stale-border) border-l-degraded bg-(--d-degraded-tint)"
          : "border-(--d-maint-border) border-l-maint bg-(--d-maint-tint)",
      )}
    >
      <StatusIcon
        name={icon}
        className={cx(
          "mt-px size-5",
          tone === "stale" ? "text-(--d-degraded-text)" : "text-(--d-maint-text)",
        )}
      />
      <div className="min-w-0">
        <h3
          className={cx(
            "m-0 mb-0.5 text-[14.5px] font-semibold",
            tone === "stale" ? "text-(--d-degraded-text)" : "text-(--d-maint-text)",
          )}
        >
          {title}
        </h3>
        <p className={cx("m-0", tone === "stale" ? "text-(--d-stale-ink)" : "text-muted")}>{children}</p>
      </div>
    </div>
  );
}

/** Out of date, delayed or never reported (hidden while a window covers the whole site). */
export function FreshnessNotice({ view }: { view: SiteView }) {
  const f = view.freshness;
  if (f.state === "fresh" || f.quietForMaintenance) return null;
  if (f.state === "empty" || f.ageS === null) {
    return (
      <Notice tone="stale" icon="clock" role="alert" title="Waiting for monitoring data">
        No monitoring source has reported yet.
      </Notice>
    );
  }
  const src = f.perSource.find((s) => s.id === f.stalestSourceId);
  const seen = src?.lastSeenAt ? ` (last data at ${fmtDayTime(src.lastSeenAt)})` : "";
  if (f.state === "stale") {
    return (
      <Notice tone="stale" icon="clock" role="alert" title="Status data is out of date">
        We have not received fresh monitoring data for <LiveAge seconds={f.ageS} now={view.now} ago={false} />
        {seen}. The services below are shown as they were last reported and marked “No recent data” until
        monitoring reports again.
      </Notice>
    );
  }
  return (
    <Notice tone="stale" icon="clock" role="status" title="Status updates are delayed">
      The newest monitoring data is <LiveAge seconds={f.ageS} now={view.now} ago={false} /> old{seen}. It
      should refresh shortly.
    </Notice>
  );
}

/** One notice per active maintenance window: its span and the services it covers. */
export function MaintenanceNotices({ view }: { view: SiteView }) {
  const windows = view.maintenance ?? [];
  if (!windows.length) return null;
  const names = serviceNames(view);
  return (
    <>
      {windows.map((m) => (
        <Notice
          key={m.id}
          tone="maint"
          icon="wrench"
          role="status"
          data={{ "data-maintenance": "" }}
          title={`Scheduled maintenance: ${m.title}`}
        >
          {fmtDayTime(m.start)} to {fmtDayTime(m.end)}.{" "}
          {m.services.length
            ? `Affects ${m.services.map((id) => names.get(id) ?? id).join(", ")}.`
            : "Affects all services."}
        </Notice>
      ))}
    </>
  );
}
