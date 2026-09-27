import { createFileRoute, notFound } from "@tanstack/react-router";
import type { ThemeId } from "@/shared/config";
import { type PageData, pageHead } from "../lib/page";
import { SitePage } from "../lib/site-page";
import { THEMES } from "../themes";

/**
 * Dev only (`vite dev`): `/_preview?fixture=default|stale|incident[&theme=<registered id>]` renders a
 * test fixture through the same theme page as `/`, for screenshots against the mock-ups. In a build
 * `import.meta.env.DEV` is false, so the loader is a plain 404 and the fixtures are never bundled.
 */
const FIXTURES = ["default", "stale", "incident"] as const;
type Fixture = (typeof FIXTURES)[number];

const pick = <T extends string>(list: readonly T[], v: unknown): T | undefined => list.find((x) => x === v);

export const Route = createFileRoute("/_preview")({
  validateSearch: (s: Record<string, unknown>): { fixture?: Fixture; theme?: ThemeId } => ({
    fixture: pick(FIXTURES, s.fixture),
    theme: pick(Object.keys(THEMES) as ThemeId[], s.theme),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }): Promise<PageData> => {
    if (!import.meta.env.DEV) throw notFound();
    const [{ fixtureInput }, { buildSiteView }] = await Promise.all([
      import("../../../tests/fixtures/view"),
      import("@/shared/view"),
    ]);
    const view = buildSiteView(fixtureInput(deps.fixture ?? "default"));
    return { view: { ...view, theme: deps.theme ?? view.theme }, commit: null };
  },
  head: ({ loaderData }) => pageHead(loaderData),
  component: () => <SitePage data={Route.useLoaderData()} />,
});
