import { Shell } from "../shell";
import { themeFor } from "../themes";
import { useLiveRefresh } from "./live";
import type { PageData } from "./page";

/** A site page: the site's theme (or its `?theme=` preview) over the loaded view, in the shell, kept fresh while visible. */
export function SitePage({ data }: { data: PageData }) {
  useLiveRefresh();
  const { Page } = themeFor(data.view.theme).module;
  return (
    <Shell view={data.view} siteTheme={data.siteTheme}>
      <Page view={data.view} commit={data.commit} />
    </Shell>
  );
}
