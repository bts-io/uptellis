import { Link, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect, useRef } from "react";
import type { Permission } from "@/shared/auth";
import type { ConfigState } from "@/shared/schemas/admin";
import type { Me } from "@/shared/schemas/auth";
import { AccountMenu } from "../account/AccountMenu";
import { when } from "./ui";

const NAV: readonly { to: string; label: string; needs: Permission }[] = [
  { to: "/admin", label: "Config", needs: "config.edit" },
  { to: "/admin/revisions", label: "Revisions", needs: "config.edit" },
  { to: "/admin/files", label: "Import and export", needs: "config.edit" },
  { to: "/admin/sources", label: "Sources", needs: "sources.manage" },
  { to: "/admin/users", label: "Users", needs: "users.manage" },
  { to: "/admin/themes", label: "Themes", needs: "config.edit" },
];

/**
 * The admin frame: site, saved version, the signed-in user's menu and the section nav (only the tabs the
 * user's permissions open). Plain layout on the kit tokens.
 */
export function AdminLayout({ state, me, children }: { state: ConfigState; me: Me; children: ReactNode }) {
  const nav = useRef<HTMLElement>(null);
  const path = useRouterState({ select: (s) => s.location.pathname });
  // On a narrow screen the tab row scrolls sideways: keep the current tab in view.
  useEffect(() => {
    nav.current
      ?.querySelector("[data-status=active]")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [path]);
  return (
    <div className="min-h-dvh bg-base font-sans text-ink">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-5xl flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-4">
          <h1 className="text-lg font-semibold">
            {state.config.name} <span className="font-normal text-muted">admin</span>
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-xs text-muted">
              version {state.version}, saved {when(state.savedAt)} by {state.savedBy}
            </p>
            {me.user && <AccountMenu user={me.user} links={[{ href: "/", label: "Status page" }]} />}
          </div>
        </div>
        <nav
          ref={nav}
          aria-label="Admin"
          className="mx-auto max-w-5xl overflow-x-auto px-4 [scrollbar-width:none]"
        >
          <ul className="flex gap-1 whitespace-nowrap">
            {NAV.filter((n) => me.permissions.includes(n.needs)).map((n) => (
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
