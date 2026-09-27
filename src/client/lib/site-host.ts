// Server only: called inside `loadSitePage`'s handler, which the Start compiler strips from the client
// bundle. The lookup runs in the Worker through the API bridge, so the configs never ship to the browser.
import { api } from "./api";

/** The site whose `hostnames` list `host`, else `fallback` (workers.dev, localhost and any other host). */
export async function siteForHost(host: string, fallback: string | undefined): Promise<string | null> {
  const { site } = await api<{ site: string | null }>(`/api/sites?host=${encodeURIComponent(host)}`);
  return site ?? fallback ?? null;
}
