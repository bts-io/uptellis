import { Panel } from "@/client/kit";
import type { ServiceView, SiteView } from "@/shared/view";
import { cx, isStale } from "./format";
import { ServiceCard } from "./ServiceCard";

/** Config sections, each a two-column grid of service cards (one column on phones). */
export function MonitorsPanel({ view }: { view: SiteView }) {
  const stale = isStale(view);
  const groups = [
    ...view.sections.map((s) => ({ id: s.id, title: s.title, services: s.services })),
    ...(view.unsectioned.length ? [{ id: "other", title: "Other", services: view.unsectioned }] : []),
  ].filter((g) => g.services.length);
  const exitCode = view.sections.some((s) => s.exitCode === 1) || view.unsectioned.some(failing) ? 1 : 0;
  const nodeFor = (s: ServiceView) => {
    const host = s.targetDisplay?.split(/[:/]/)[0];
    return view.topology?.nodes.find((n) => n.id === host || n.label === host) ?? null;
  };
  const firstId = groups[0]?.services[0]?.id;

  return (
    <Panel
      id="monitors"
      title="monitors"
      exitCode={exitCode}
      aside={`${view.summary.up}/${view.summary.total} up`}
      className={cx(stale && "border-dashed")}
    >
      <div className="mt-3 flex flex-col gap-[30px] max-[760px]:gap-6">
        {groups.map((g) => (
          <section key={g.id} aria-label={g.title}>
            <h2 className="mb-4 text-[10.5px] tracking-[.08em] text-faint uppercase">{g.title}</h2>
            <div className="grid grid-cols-2 gap-x-[18px] gap-y-[30px] max-[760px]:grid-cols-1 max-[760px]:gap-6">
              {g.services.map((s) => (
                <ServiceCard
                  key={s.id}
                  service={s}
                  node={nodeFor(s)}
                  stale={stale}
                  generatedAt={view.generatedAt}
                  defaultOpen={s.id === firstId || s.state === "down"}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Panel>
  );
}

const failing = (s: ServiceView) => s.state !== "up" && s.state !== "maintenance";
