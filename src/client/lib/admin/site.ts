/**
 * The site `/admin` edits: the one this host serves, as for the site page. Only the slug crosses the server
 * function (it is in every page's view anyway); the admin data itself is fetched through `api()`, so it
 * stays behind the admin gate on `/api/admin/*` whether the loader runs in SSR or in the browser.
 */
import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { siteForHost } from "../site-host";

type RequestContext = { siteDefault?: string } | undefined;

export const adminSite = createServerFn({ method: "GET" }).handler(async ({ context }): Promise<string> => {
  const site = await siteForHost(getRequestUrl().hostname, (context as RequestContext)?.siteDefault);
  if (!site) throw notFound();
  return site;
});
