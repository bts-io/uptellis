/**
 * The site `/admin` edits: the one this host serves, as for the site page and setup (`siteForHost`), so a
 * site setup just created on `localhost` is the one the dashboard, welcome screen and top bar show. Only
 * the slug crosses the server function (it is in every page's view anyway); the admin data itself is
 * fetched through `api()`, so it stays behind the admin gate on `/api/admin/*` whether the loader runs in
 * SSR or in the browser.
 */
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import { AUTH_PAGES } from "@/shared/schemas/auth";
import { siteForHost } from "../site-host";

export const adminSite = createServerFn({ method: "GET" }).handler(async (): Promise<string> => {
  const site = await siteForHost(getRequestUrl().hostname);
  // No site yet (setup left before its second step): that step creates one, or answers 404 without the right.
  if (!site) throw redirect({ href: AUTH_PAGES.setup });
  return site;
});
