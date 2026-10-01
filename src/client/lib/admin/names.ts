/**
 * The one name admin shows for a service: its own when it has one, else where it comes from and its
 * external id in plain words (`Uptime Kuma monitor 1`, `Facts from app-1`, `Webhook ci`, `Check web`), never
 * "Unknown service" and never the raw id. Used by the Monitors rows, the status page catalog, the
 * services map of the settings and alerts, and the sections editor.
 */

const FROM: Record<string, (external: string) => string> = {
  kuma: (x) => `Uptime Kuma monitor ${x}`,
  facts: (x) => `Facts from ${x}`,
  webhook: (x) => `Webhook ${x}`,
  probe: (x) => `Check ${x}`,
};

export function serviceLabel(id: string, name?: string | null): string {
  const own = name?.trim();
  if (own) return own;
  const at = id.indexOf(":");
  const words = at > 0 ? FROM[id.slice(0, at)] : undefined;
  return words && at < id.length - 1 ? words(id.slice(at + 1)) : id;
}
