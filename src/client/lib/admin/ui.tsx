/** Plain admin building blocks on the kit's semantic tokens (no theme components), usable at 390px wide. */
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { type ComponentProps, type ReactNode, useId, useState } from "react";
import type { ConfigDiffEntry, ConfigIssue } from "@/shared/schemas/admin";
import { cx } from "../../kit/cx";

export function Button({
  tone = "plain",
  className,
  ...props
}: ComponentProps<"button"> & { tone?: "plain" | "primary" | "danger" }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 border px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50",
        tone === "primary" && "border-accent bg-accent font-medium text-(--color-base) hover:opacity-90",
        tone === "danger" && "border-down text-down hover:bg-down/10",
        tone === "plain" && "border-line text-ink hover:bg-raised",
        className,
      )}
    />
  );
}

export function Card({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-line bg-panel">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {aside}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

const NOTICE_TONE = {
  info: "border-line text-ink",
  ok: "border-up text-ink",
  warn: "border-degraded text-ink",
  error: "border-down text-ink",
} as const;

export function Notice({
  tone = "info",
  children,
  className,
}: {
  tone?: keyof typeof NOTICE_TONE;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" || tone === "warn" ? "alert" : "status"}
      className={cx("border-l-2 bg-raised px-3 py-2 text-sm", NOTICE_TONE[tone], className)}
    >
      {children}
    </div>
  );
}

/** Issues at `path` or below it (`sections.1` also takes `sections.1.title`). */
export function issuesAt(issues: ConfigIssue[], path: string): ConfigIssue[] {
  return issues.filter((i) => i.path === path || i.path.startsWith(`${path}.`));
}

export function IssueText({ issues }: { issues: ConfigIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="mt-1 text-xs text-down">
      {issues.map((i) => (
        <li key={i.path + i.message}>{i.message}</li>
      ))}
    </ul>
  );
}

const INPUT = "w-full min-w-0 border border-line bg-base px-2 py-1.5 text-sm text-ink placeholder:text-faint";

/** A labelled input with its issues underneath; `aria-invalid` and `aria-describedby` follow them. */
export function Field({
  label,
  issues = [],
  className,
  ...input
}: ComponentProps<"input"> & { label: string; issues?: ConfigIssue[] }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={issues.length > 0 || undefined}
        aria-describedby={issues.length ? `${id}-issues` : undefined}
        {...input}
        className={cx(INPUT, "mt-1", issues.length > 0 && "border-down")}
      />
      <div id={`${id}-issues`}>
        <IssueText issues={issues} />
      </div>
    </div>
  );
}

export function SelectField({
  label,
  children,
  className,
  ...select
}: ComponentProps<"select"> & { label: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs text-muted">
        {label}
      </label>
      <select id={id} {...select} className={cx(INPUT, "mt-1")}>
        {children}
      </select>
    </div>
  );
}

export const inputClass = INPUT;

const show = (v: unknown) => (v === undefined ? "" : JSON.stringify(v));

/** A config diff as a table: path, what happened, before and after. */
export function DiffTable({ diff }: { diff: ConfigDiffEntry[] }) {
  if (!diff.length) return <p className="text-sm text-muted">No changes.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Changes</caption>
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-1 pr-3 font-normal">Field</th>
            <th className="py-1 pr-3 font-normal">Change</th>
            <th className="py-1 pr-3 font-normal">Before</th>
            <th className="py-1 font-normal">After</th>
          </tr>
        </thead>
        <tbody className="font-mono text-xs">
          {diff.map((d) => (
            <tr key={`${d.op}:${d.path}`} className="border-t border-hair align-top">
              <td className="py-1.5 pr-3 break-all">{d.path}</td>
              <td
                className={cx(
                  "py-1.5 pr-3",
                  d.op === "add" && "text-up",
                  d.op === "remove" && "text-down",
                  d.op === "change" && "text-degraded",
                )}
              >
                {d.op}
              </td>
              <td className="py-1.5 pr-3 break-all text-muted">{show(d.before)}</td>
              <td className="py-1.5 break-all">{show(d.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A modal on the kit tokens; closes on Esc and on the backdrop. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-base/75" />
      <div className="fixed inset-0 overflow-y-auto px-4 pt-[12vh] pb-4">
        <DialogPanel className="mx-auto max-w-lg border border-line bg-panel p-5 font-sans text-ink shadow-2xl">
          <DialogTitle className="text-[15px] font-semibold text-ink">{title}</DialogTitle>
          <div className="mt-3">{children}</div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirm,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirm: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="text-sm text-muted">{children}</div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" onClick={onConfirm} disabled={busy}>
          {confirm}
        </Button>
      </div>
    </Modal>
  );
}

/** `2026-09-27 14:05 UTC` from an ISO time. */
export const when = (iso: string | null | undefined) =>
  iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : "never";

/**
 * A read-only value with a copy button and a polite result line (a one-time secret, an invite link). The
 * text is selected on focus so it can still be copied by hand where the clipboard is unavailable.
 */
export function CopyField({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) {
  const id = useId();
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        readOnly
        value={value}
        onFocus={(e) => e.target.select()}
        className="w-full border border-line bg-base px-2 py-1.5 font-mono text-xs text-ink"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button tone="primary" onClick={() => void copy()}>
          {copyLabel}
        </Button>
        <span role="status" className="text-xs text-muted">
          {copied === true ? "Copied." : copied === false ? "Copy failed: select the text and copy it." : ""}
        </span>
      </div>
    </div>
  );
}
