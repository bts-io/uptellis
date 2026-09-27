import { type ReactNode, useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * Renders `children` only on the client, after hydration (and `fallback`, default nothing, on the server and
 * in the hydration pass), so anything that measures or draws cannot make the server markup differ.
 */
export function ClientOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const client = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  return <>{client ? children : fallback}</>;
}
