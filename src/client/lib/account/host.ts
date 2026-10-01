/**
 * The host the browser used and the site it resolves to, for first-run setup: a server function, so the
 * lookup (`siteForHost`) runs in the Worker during SSR and in the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { siteForHost } from "../site-host";

export const setupHost = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ host: string; site: string | null }> => {
    const host = getRequestUrl().hostname;
    return { host, site: await siteForHost(host) };
  },
);
