/**
 * Plain names for things Settings lists by id: a source reads as its kind and name ("Uptime Kuma (watch-1)"),
 * never as the raw `kuma:watch-1`.
 */
import type { SourceKind } from "@/shared/model";

export const SOURCE_KIND_NAME: Record<SourceKind, string> = {
  kuma: "Uptime Kuma",
  facts: "Facts collector",
  webhook: "Webhook",
  probe: "Edge check",
};

/** `Uptime Kuma (watch-1)` from `kuma:watch-1`; an id of no known kind is returned as is. */
export function sourceLabel(id: string): string {
  const i = id.indexOf(":");
  if (i < 0) return id;
  const name = SOURCE_KIND_NAME[id.slice(0, i) as SourceKind];
  return name ? `${name} (${id.slice(i + 1)})` : id;
}
