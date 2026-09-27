import { useRouter } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";

export const ERROR_RETRY_S = 15;

function Plain({ code, title, children }: { code: string; title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-base px-6 text-center text-ink">
      <p className="font-mono text-sm text-muted">{code}</p>
      <h1 className="font-mono text-2xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}

/** Unknown path or unknown site. */
export function NotFoundPage() {
  return (
    <Plain code="404" title="Not found">
      <p className="text-muted">There is no status page here.</p>
    </Plain>
  );
}

/**
 * The API failed while loading the page. Never shows the error itself (no messages, no stacks); retries on
 * its own every `ERROR_RETRY_S` seconds and on demand.
 */
export function ErrorPage() {
  const router = useRouter();
  const [left, setLeft] = useState(ERROR_RETRY_S);
  useEffect(() => {
    if (left === 0) {
      void router.invalidate();
      setLeft(ERROR_RETRY_S);
      return;
    }
    const t = setTimeout(() => setLeft(left - 1), 1000);
    return () => clearTimeout(t);
  }, [left, router]);
  return (
    <Plain code="error" title="Status data is unavailable">
      <p className="text-muted">
        The status API did not answer. Retrying in <span className="font-mono tabular-nums">{left}</span> s.
      </p>
      <button
        type="button"
        onClick={() => setLeft(0)}
        className="border border-line px-4 py-2 font-mono text-sm text-ink hover:bg-panel"
      >
        Retry now
      </button>
    </Plain>
  );
}
