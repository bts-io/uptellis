import { createFileRoute, retainSearchParams } from "@tanstack/react-router";
import type { ThemeId } from "@/shared/config";
import { loadPage, pageHead, withPreviewTheme } from "../lib/page";
import { SitePage } from "../lib/site-page";
import { isRegisteredTheme } from "../themes";

/**
 * The site for this host, rendered by its theme. Unknown site: 404 page; API failure: error page.
 * `?theme=<registered id>` previews another theme for this tab only (never saved); links to `/` keep it,
 * and the live refresh reruns the loader with it. Unknown ids are dropped.
 */
export const Route = createFileRoute("/")({
  // `theme` is always set (to undefined when invalid): an absent key would let the raw value through.
  validateSearch: (s: Record<string, unknown>): { theme?: ThemeId } => ({
    theme: isRegisteredTheme(s.theme) ? s.theme : undefined,
  }),
  search: { middlewares: [retainSearchParams(["theme"])] },
  loaderDeps: ({ search }) => ({ theme: search.theme }),
  loader: async ({ deps }) => withPreviewTheme(await loadPage(), deps.theme),
  head: ({ loaderData }) => pageHead(loaderData),
  component: () => <SitePage data={Route.useLoaderData()} />,
});
