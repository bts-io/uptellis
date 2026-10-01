/**
 * `Toast`: short confirmations ("Paused API health") in one polite live region, so a screen reader
 * announces each one. `ToastProvider` wraps the admin (AdminLayout does it); anything inside calls
 * `useToast()`:
 *
 *   const toast = useToast();
 *   toast("Added monitor Checkout");
 *   toast("That did not work. Try again.", "error");
 *
 * A toast stays 5 seconds (errors 8); a new one replaces the current one. Outside a provider `useToast`
 * returns a function that does nothing, so a component still renders in isolation.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { cx } from "../../kit/cx";

export type ToastTone = "ok" | "error";
type Show = (message: string, tone?: ToastTone) => void;

const ToastContext = createContext<Show>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: ToastTone; n: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback<Show>((message, tone = "ok") => {
    clearTimeout(timer.current);
    setToast((t) => ({ message, tone, n: (t?.n ?? 0) + 1 }));
    timer.current = setTimeout(() => setToast(null), tone === "error" ? 8000 : 5000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-toast
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4 sm:bottom-6"
      >
        {toast && (
          <p
            key={toast.n}
            className={cx(
              "pointer-events-auto max-w-md border bg-panel px-4 py-2.5 text-sm text-ink shadow-xl",
              toast.tone === "error" ? "border-down" : "border-line",
            )}
          >
            {toast.message}
          </p>
        )}
      </div>
    </ToastContext.Provider>
  );
}
