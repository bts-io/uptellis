import { createRootRoute, HeadContent, Outlet, Scripts, useMatches } from "@tanstack/react-router";
import type { PageData } from "../lib/page";
import appCss from "../styles.css?url";
import { type RegisteredTheme, themeFor, themeHead } from "../themes";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      // Site pages override the title from the view (src/client/lib/page.ts); theme-color is in RootDocument.
      { title: "Status" },
      // Private dashboard: never indexed, whatever host it ends up on.
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootDocument,
});

/**
 * The theme of the page being shown (from its loader data, a `?theme=` preview included), else the default
 * theme for 404, errors and the admin pages.
 */
function useShownTheme(): RegisteredTheme {
  return useMatches({
    select: (matches) => {
      const page = matches.findLast((m) => (m.loaderData as Partial<PageData> | undefined)?.view);
      return themeFor((page?.loaderData as PageData | undefined)?.view.theme);
    },
  });
}

function RootDocument() {
  const theme = useShownTheme();
  const { colors, fonts } = themeHead(theme);
  return (
    <html lang="en" data-theme={theme.module.dataTheme} className="bg-base" suppressHydrationWarning>
      <head>
        {/* Before any module: Zod otherwise probes `new Function` once, which the CSP (no eval) reports. */}
        <script dangerouslySetInnerHTML={{ __html: "globalThis.__zod_globalConfig={jitless:true}" }} />
        <HeadContent />
        {colors.map((c) => (
          <meta key={c.media ?? "all"} name="theme-color" content={c.content} media={c.media} />
        ))}
        {/* The shown theme's self-hosted fonts (public/fonts), so the first paint does not wait on the stylesheet. */}
        {fonts.map((href) => (
          <link key={href} rel="preload" href={href} as="font" type="font/woff2" crossOrigin="anonymous" />
        ))}
      </head>
      <body className="min-h-dvh bg-base font-sans text-ink antialiased">
        <Outlet />
        <Scripts />
      </body>
    </html>
  );
}
