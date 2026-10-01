/**
 * The Getting started card on the Monitors dashboard: items ticked from the saved config and what the
 * server reports (`checklistItems`), a progress bar and count, a link or a button for each open item, and
 * "Hide" (remembered in this browser). It is gone once every item is done.
 */
import { useEffect, useId, useState } from "react";
import type { SiteConfig } from "@/shared/config";
import { cx } from "../../../kit/cx";
import { AdminIcon } from "../icons";
import { Button } from "../ui";
import {
  type ChecklistFacts,
  type ChecklistItem,
  checklistHidden,
  checklistItems,
  hideChecklist,
} from "./firstRun";

export interface ChecklistProps {
  site: string;
  config: SiteConfig;
  facts: ChecklistFacts;
  /** Follows an item's link inside the admin (a plain link without it). */
  onNavigate?: (to: string) => void;
  /** "Send" on the test alert item. */
  onSendTest: () => void;
  /** "Add a heartbeat for a cron job": opens the New heartbeat drawer. */
  onNewHeartbeat: () => void;
  /** True while the test alert is being sent. */
  busy?: boolean;
}

export function Checklist({
  site,
  config,
  facts,
  onNavigate,
  onSendTest,
  onNewHeartbeat,
  busy,
}: ChecklistProps) {
  const id = useId();
  // Unknown until mounted (storage is read in the browser only), so the server never renders it hidden.
  const [hidden, setHidden] = useState<boolean | null>(null);
  useEffect(() => setHidden(checklistHidden(site)), [site]);

  const items = checklistItems(config, facts);
  const done = items.filter((i) => i.done).length;
  if (hidden !== false || done === items.length) return null;

  const hide = () => {
    hideChecklist(site);
    setHidden(true);
  };
  const action = (item: ChecklistItem) => {
    const label = (
      <>
        <Tick done={false} />
        {item.label}
      </>
    );
    if (item.key === "test")
      return (
        <span className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2">{label}</span>
          <Button onClick={onSendTest} disabled={busy} className="py-0.5 text-xs">
            <AdminIcon name="send" size={12} />
            Send
          </Button>
        </span>
      );
    if (item.key === "heartbeat")
      return (
        <button
          type="button"
          onClick={onNewHeartbeat}
          className="flex items-center gap-2 text-accent hover:underline"
        >
          {label}
        </button>
      );
    return (
      <a
        href={item.to}
        onClick={(e) => {
          if (!onNavigate || !item.to) return;
          e.preventDefault();
          onNavigate(item.to);
        }}
        className="flex items-center gap-2 text-accent hover:underline"
      >
        {label}
      </a>
    );
  };

  return (
    <section
      aria-labelledby={`${id}-h`}
      data-checklist
      className="mb-6 grid gap-4 border border-line bg-panel p-4 md:grid-cols-[14rem_1fr_auto]"
    >
      <div>
        <h2 id={`${id}-h`} className="font-semibold text-ink">
          Getting started
        </h2>
        <p className="text-sm text-muted">
          {done} of {items.length} done
        </p>
        <div
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-valuenow={done}
          className="mt-2 h-1.5 bg-raised"
        >
          <span className="block h-full bg-accent" style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      </div>
      <ol className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.key} data-item={item.key} data-done={item.done || undefined}>
            {item.done ? (
              <span className="flex items-center gap-2 text-muted line-through">
                <Tick done />
                {item.label}
                <span className="sr-only"> (done)</span>
              </span>
            ) : (
              action(item)
            )}
          </li>
        ))}
      </ol>
      <div>
        <Button onClick={hide} className="py-1 text-xs">
          Hide
        </Button>
      </div>
    </section>
  );
}

function Tick({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-full border",
        done ? "border-up bg-up text-(--color-base)" : "border-line",
      )}
    >
      {done && <AdminIcon name="check" size={12} />}
    </span>
  );
}
