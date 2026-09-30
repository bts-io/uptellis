/**
 * Phase 7b placeholder for the Friendly theme (mock-up: mockups/friendly/ on branch p7/mockups).
 * Renders the essentials until the theme is built; replaced by the theme stream.
 */
import type { ThemePageProps } from "../types";

export function Page({ view }: ThemePageProps) {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1>{view.site.name}</h1>
      <p>{view.verdict.label}</p>
    </main>
  );
}
