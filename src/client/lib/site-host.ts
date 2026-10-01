// Server only: called inside server function handlers (`loadSitePage`, `adminSite`, `setupHost`), which the
// Start compiler strips from the client bundle. The lookup runs in the Worker through the API bridge, so the
// configs never ship to the browser.
import { api } from "./api";

/**
 * The site a request on `host` gets: the read API's `resolveSite` (the site listing the hostname, else
 * `SITE_DEFAULT`, else the only or first-created site), so the page, admin and setup always agree. Null on
 * an instance with no site yet.
 */
export async function siteForHost(host: string): Promise<string | null> {
  const { site } = await api<{ site: string | null }>(`/api/sites?host=${encodeURIComponent(host)}`);
  return site;
}
