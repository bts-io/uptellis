/**
 * `Drawer`: a panel that slides over the right side of the page, on a native `<dialog>` opened with
 * `showModal()` (the page behind is inert and the backdrop dims it). On a phone it is a full-screen sheet.
 *
 *   <Drawer open={open} onClose={() => setOpen(false)} title="New monitor" footer={<Button>Create</Button>}>
 *     ...form...
 *   </Drawer>
 *
 * Props:
 * - `open`, `onClose`: controlled. Escape, the backdrop, the close button all call `onClose`; the parent
 *   sets `open` false. Children render only while open.
 * - `title`: the dialog's accessible name (its `h2`). `description` (optional): a line under it.
 * - `wide`: a wider panel for details (48rem instead of 32rem on a wide screen).
 * - `footer`: actions pinned under the scrolling body (Cancel, Save).
 * - `initialFocus`: a CSS selector inside the drawer to focus on open (e.g. `#monitor-url`); without it the
 *   first `[data-autofocus]` element, else the close button.
 *
 * Focus stays inside while open (Tab and Shift+Tab wrap), and returns to the element that had it before
 * opening when the drawer closes (the "New monitor" button, the row's "Open details").
 */
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { cx } from "../../kit/cx";
import { AdminIcon } from "./icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
  initialFocus?: string;
  children?: ReactNode;
}

export function Drawer({
  open,
  onClose,
  title,
  description,
  wide,
  footer,
  initialFocus,
  children,
}: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      const target =
        (initialFocus && dialog.querySelector<HTMLElement>(initialFocus)) ||
        dialog.querySelector<HTMLElement>("[data-autofocus]") ||
        dialog.querySelector<HTMLElement>("[data-drawer-close]");
      target?.focus();
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
      const back = opener.current;
      opener.current = null;
      if (back?.isConnected) back.focus();
    }
  }, [open, initialFocus]);

  // Unmounting while open (a route change) still hands focus back.
  useEffect(
    () => () => {
      const back = opener.current;
      if (back?.isConnected) back.focus();
    },
    [],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close.current();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => !el.closest("[hidden]") && !el.closest("details:not([open]) > :not(summary)"),
    );
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !e.currentTarget.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !e.currentTarget.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onKeyDown={onKeyDown}
      // The browser's own Escape handling: keep the dialog under React's control.
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
      // A click on the dialog element itself is a click on the backdrop (the panel fills the rest).
      onClick={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
      className={cx(
        "fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none border-0 bg-transparent p-0 font-sans text-ink backdrop:bg-base/75",
        "sm:left-auto sm:w-[32rem]",
        wide && "sm:w-[48rem]",
      )}
    >
      {open && (
        <div className="flex h-full flex-col border-line bg-panel sm:border-l">
          <div className="flex items-start justify-between gap-3 border-b border-line py-3 pr-3 pl-5">
            <div className="min-w-0 pt-1">
              <h2 id={titleId} className="text-lg font-semibold text-ink">
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-0.5 text-sm text-muted">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              data-drawer-close
              onClick={() => close.current()}
              className="inline-flex size-10 shrink-0 items-center justify-center text-muted hover:bg-raised hover:text-ink"
            >
              <AdminIcon name="x" size={20} />
              <span className="sr-only">Close</span>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
              {footer}
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
