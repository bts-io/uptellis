/**
 * The admin frame: a slim top bar with the logo, the site's name, four tabs (Monitors, Status page, Alerts,
 * Settings; only those the user's permissions open) with a red badge on Monitors counting what is down, and
 * the user's menu. On a phone the tabs move to a bar at the bottom of the screen. It also holds the toast
 * region (`ToastProvider`), so every page can call `useToast()`.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { Me } from "@/shared/schemas/auth";
import { AccountMenu } from "../account/AccountMenu";
import { AdminIcon } from "./icons";
import { ADMIN_TABS, allowed } from "./nav";
import { ToastProvider } from "./Toast";

export interface AdminLayoutProps {
  /** The site's name, as its config says. */
  siteName: string;
  me: Me;
  /** How many things are down right now (the Monitors badge; hidden at 0). */
  downCount: number;
  /** A focused page (the first-run screen): the top bar without the tabs. */
  bare?: boolean;
  children?: ReactNode;
}

export function AdminLayout({ siteName, me, downCount, bare = false, children }: AdminLayoutProps) {
  const tabs = bare ? [] : ADMIN_TABS.filter((t) => allowed(t.needs, me.permissions));
  return (
    <ToastProvider>
      <div className="min-h-dvh bg-base font-sans text-ink">
        <a
          href="#admin-main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:bg-panel focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <header className="sticky top-0 z-40 border-b border-line bg-panel">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
            <Link to="/admin" className="flex shrink-0 items-center gap-2 font-semibold text-ink">
              <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" className="text-accent">
                <rect width="32" height="32" rx="9" fill="currentColor" />
                <path
                  d="M7 17h4l3-7 4 13 3-6h4"
                  fill="none"
                  stroke="var(--color-base)"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span className="max-sm:sr-only">Uptellis</span>
            </Link>
            <span className="min-w-0 truncate border-l border-line pl-3 text-sm text-muted" data-site-name>
              {siteName}
            </span>
            <nav
              hidden={bare}
              aria-label="Admin"
              className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-40 max-sm:border-t max-sm:border-line max-sm:bg-panel sm:ml-4"
            >
              <ul className="flex gap-1 max-sm:justify-around max-sm:px-1 max-sm:pb-[env(safe-area-inset-bottom)]">
                {tabs.map((t) => (
                  <li key={t.to} className="max-sm:flex-1">
                    <Link
                      to={t.to}
                      activeOptions={{ exact: t.exact }}
                      className="relative flex items-center gap-2 px-3 py-2 text-sm font-medium text-muted hover:bg-raised hover:text-ink data-[status=active]:bg-raised data-[status=active]:text-ink max-sm:min-h-14 max-sm:flex-col max-sm:justify-center max-sm:gap-0.5 max-sm:px-1 max-sm:text-xs"
                    >
                      <AdminIcon name={t.icon} size={18} />
                      <span>{t.label}</span>
                      {t.to === "/admin" && downCount > 0 && (
                        <span
                          data-down-badge
                          className="rounded-full bg-down px-2 text-xs leading-5 font-bold text-(--color-base) max-sm:absolute max-sm:top-1 max-sm:left-1/2 max-sm:ml-2 max-sm:px-1.5 max-sm:text-[11px]"
                        >
                          {downCount}
                          <span className="sr-only"> down</span>
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              {me.user && (
                <AccountMenu user={me.user} links={[{ href: "/", label: "Open the status page" }]} />
              )}
            </div>
          </div>
        </header>
        <main id="admin-main" tabIndex={-1} className="mx-auto max-w-6xl px-4 pt-6 pb-24 sm:pb-10">
          {children}
        </main>
      </div>
    </ToastProvider>
  );
}
