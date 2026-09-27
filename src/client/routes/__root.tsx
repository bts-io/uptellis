import { createRootRoute, HeadContent, Outlet, Scripts, useMatches } from "@tanstack/react-router";
import type { PageData } from "../lib/page";
import appCss from "../styles.css?url";
import { DEFAULT_THEME, themeFor } from "../themes";

// Self-hosted fonts (public/fonts), preloaded so the first paint does not wait on the stylesheet.
const fontPreload = (href: string) =>
  ({ rel: "preload", href, as: "font", type: "font/woff2", crossOrigin: "anonymous" }) as const;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      // Site pages override these two from the view (src/client/lib/page.ts).
      { name: "theme-color", content: DEFAULT_THEME.themeColor },
      { title: "Status" },
      // Private dashboard: never indexed, whatever host it ends up on.
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [
      fontPreload("/fonts/Geist-Variable.woff2"),
      fontPreload("/fonts/JetBrainsMono-Variable.woff2"),
      { rel: "stylesheet", href: appCss },
    ],
  }),
  component: RootDocument,
});

/** The theme of the page being shown (from its loader data), else the default theme for 404 and errors. */
function useDataTheme(): string {
  return useMatches({
    select: (matches) => {
      const page = matches.findLast((m) => (m.loaderData as Partial<PageData> | undefined)?.view);
      return themeFor((page?.loaderData as PageData | undefined)?.view.theme).module.dataTheme;
    },
  });
}

function RootDocument() {
  return (
    <html lang="en" data-theme={useDataTheme()} className="bg-base" suppressHydrationWarning>
      <head>
        {/* Before any module: Zod otherwise probes `new Function` once, which the CSP (no eval) reports. */}
        <script dangerouslySetInnerHTML={{ __html: "globalThis.__zod_globalConfig={jitless:true}" }} />
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-base font-sans text-ink antialiased">
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
