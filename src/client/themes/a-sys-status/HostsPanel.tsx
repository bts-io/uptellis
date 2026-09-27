import { Panel, StateDot } from "@/client/kit";
import type { SiteView } from "@/shared/view";
import { cx, probeStale } from "./format";

/** The machines of the topology: state, roles, location. */
export function HostsPanel({ view }: { view: SiteView }) {
  const nodes = view.topology?.nodes ?? [];
  if (!nodes.length) return null;
  const stale = probeStale(view);
  return (
    <Panel title="hosts" aside={`${nodes.length} machines`} className={cx(stale && "border-dashed")}>
      <ul className={cx("mt-1.5", stale && "saturate-[.4]")}>
        {nodes.map((n) => (
          <li
            key={n.id}
            className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-dashed border-hair py-2"
          >
            <StateDot state={n.state} />
            <div className="min-w-0">
              <div className="font-semibold">{n.label}</div>
              <div className="text-xs text-muted">
                {[n.roles.join(" + "), n.note && !n.roles.some((r) => r === n.note) ? n.note : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            <div className="text-right text-[11.5px] text-faint">{n.location}</div>
          </li>
        ))}
      </ul>
      <p className="pt-3 text-[11.5px] text-faint">tailnet hostnames only; addresses are never rendered</p>
    </Panel>
  );
}
