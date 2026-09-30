/**
 * Data for a site page: the site is picked from the request host, then the view and the build commit come
 * from the API. `loadSitePage` is a server function, so the host lookup always runs in the Worker (with
 * `SITE_DEFAULT` from the request context) and the loader behaves the same during SSR and on a client refresh.
 */
import { notFound, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";
import type { ThemeId } from "@/shared/config";
import { AUTH_PAGES, Me } from "@/shared/schemas/auth";
import type { SiteView, VerdictView } from "@/shared/view";
import { ApiError, api } from "./api";
import { siteForHost } from "./site-host";

export interface PageData {
  view: SiteView;
  /** Build commit for the footer; null when /api/health could not say. */
  commit: string | null;
  /** The site's configured theme while `view.theme` shows a `?theme=` preview; absent otherwise. */
  siteTheme?: ThemeId;
}

/**
 * The Start request context src/worker/serve.ts passes. Read untyped here: registering it on `Register` makes the
 * router type depend on this function's context type, a cycle TypeScript resolves to `undefined`.
 */
type RequestContext = { siteDefault?: string } | undefined;

/**
 * What a site page the read API would not show becomes: a fresh instance goes to setup, a signed-out
 * visitor to sign-in (the site may be private), a signed-in user without access sees the 404 page, which
 * says nothing about whether the site exists.
 */
async function hiddenSite() {
  const me = Me.parse(await api("/api/me"));
  if (me.setupNeeded) return redirect({ href: AUTH_PAGES.setup });
  if (!me.user) return redirect({ href: `${AUTH_PAGES.signIn}?next=%2F` });
  return notFound();
}

export const loadSitePage = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<PageData> => {
    const site = await siteForHost(getRequestUrl().hostname, (context as RequestContext)?.siteDefault);
    if (!site) throw notFound();
    const [view, commit] = await Promise.all([
      api<SiteView>(`/api/sites/${encodeURIComponent(site)}/view`).catch(async (err: unknown) => {
        if (err instanceof ApiError && err.status === 404) throw await hiddenSite();
        throw err;
      }),
      api<{ commit?: string }>("/api/health").then(
        (h) => h.commit ?? null,
        () => null,
      ),
    ]);
    return { view, commit };
  },
);

/** Last good page in this tab: a failed background refresh keeps showing it instead of the error page. */
let lastGood: PageData | null = null;

/** Route loader: the first load surfaces errors (404 or error page); later refreshes fall back to `lastGood`. */
export async function loadPage(): Promise<PageData> {
  try {
    const data = await loadSitePage();
    if (typeof window !== "undefined") lastGood = data;
    return data;
  } catch (err) {
    if (typeof window !== "undefined" && lastGood) return lastGood;
    throw err;
  }
}

/**
 * The page with `theme` shown instead of the site's own (`?theme=` preview): `view.theme` drives the page,
 * `data-theme`, `theme-color` and the font preloads, so every consumer follows it. Nothing is stored.
 */
export function withPreviewTheme(data: PageData, theme: ThemeId | undefined): PageData {
  if (!theme || theme === data.view.theme) return data;
  return { ...data, view: { ...data.view, theme }, siteTheme: data.view.theme };
}

/** `1 down`, `2 degraded`, `maintenance`, `stale`, `no data`; null when all is well. */
export function verdictPrefix(v: VerdictView): string | null {
  switch (v.state) {
    case "operational":
      return null;
    case "outage":
      return `${v.down} down`;
    case "degraded":
      return `${v.degraded} degraded`;
    case "maintenance":
      return "maintenance";
    case "stale":
      return "stale";
    case "empty":
      return "no data";
  }
}

/**
 * Document title: the slug upper-cased (`DEMO status`), prefixed with the verdict when not operational
 * (`1 down | DEMO status`).
 */
export function pageTitle(view: SiteView): string {
  const base = `${view.site.slug.toUpperCase()} status`;
  const prefix = verdictPrefix(view.verdict);
  return prefix ? `${prefix} | ${base}` : base;
}

const VERDICT_COLOR: Record<VerdictView["state"], string> = {
  operational: "#3ddc84",
  degraded: "#ffb020",
  outage: "#ff6b6b",
  maintenance: "#7aa2ff",
  stale: "#8a90a6",
  empty: "#8a90a6",
};

/** A small dot in the verdict's colour, as an inline SVG data URL. */
export function faviconHref(v: VerdictView): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="${VERDICT_COLOR[v.state]}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * Route `head` for a site page; the root route supplies the rest (robots, stylesheet), and the root document
 * the shown theme's `theme-color` and font preloads (`themeHead`, src/client/themes).
 */
export function pageHead(data: PageData | undefined) {
  if (!data) return {};
  return {
    meta: [{ title: pageTitle(data.view) }],
    links: [{ rel: "icon", type: "image/svg+xml", href: faviconHref(data.view.verdict) }],
  };
}
