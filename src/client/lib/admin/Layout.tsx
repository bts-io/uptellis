import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { ConfigState } from "@/shared/schemas/admin";
import { when } from "./ui";

const NAV = [
  { to: "/admin", label: "Config" },
  { to: "/admin/revisions", label: "Revisions" },
  { to: "/admin/files", label: "Import and export" },
  { to: "/admin/sources", label: "Sources" },
  { to: "/admin/themes", label: "Themes" },
] as const;

/** The admin frame: site, saved version and the section nav. Plain layout on the kit tokens. */
export function AdminLayout({ state, children }: { state: ConfigState; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-base font-sans text-ink">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-5xl flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-4">
          <h1 className="text-lg font-semibold">
            {state.config.name} <span className="font-normal text-muted">admin</span>
          </h1>
          <p className="text-xs text-muted">
            version {state.version}, saved {when(state.savedAt)} by {state.savedBy}
          </p>
        </div>
        <nav aria-label="Admin" className="mx-auto max-w-5xl overflow-x-auto px-4 [scrollbar-width:none]">
          <ul className="flex gap-1 whitespace-nowrap">
            {NAV.map((n) => (
              <li key={n.to}>
                <Link
                  to={n.to}
                  activeOptions={{ exact: true }}
                  className="inline-block border-b-2 border-transparent px-2 py-2 text-sm text-muted hover:text-ink data-[status=active]:border-accent data-[status=active]:text-ink"
                >
                  {n.label}
                </Link>
              </li>
            ))}
            <li className="ml-auto">
              <a href="/" className="inline-block px-2 py-2 text-sm text-muted hover:text-ink">
                Status page
              </a>
            </li>
          </ul>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
