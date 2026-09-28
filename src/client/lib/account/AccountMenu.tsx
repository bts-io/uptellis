import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import { useState } from "react";
import type { UserSummary } from "@/shared/schemas/auth";
import { signOut } from "./client";

const ITEM = "block w-full px-3 py-2 text-left text-sm text-ink data-focus:bg-raised";

/** Signs out, then loads the status page as a full navigation (every loader runs signed out). */
export async function signOutAndLeave(): Promise<void> {
  await signOut();
  window.location.assign("/");
}

/**
 * The signed-in user's menu for page headers: who is signed in, `links` (other places this user may go),
 * the account page and sign-out. A Headless UI menu on the kit tokens (keyboard and screen reader ready).
 */
export function AccountMenu({
  user,
  links = [],
}: {
  user: UserSummary;
  links?: { href: string; label: string }[];
}) {
  const [failed, setFailed] = useState(false);
  return (
    <Menu as="div" className="relative">
      <MenuButton
        id="account-menu"
        className="inline-flex max-w-[14rem] items-center gap-2 border border-line px-2.5 py-1.5 text-sm text-ink hover:bg-raised"
      >
        <span className="truncate">{user.name}</span>
        <span className="text-xs text-muted">{user.role}</span>
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        className="z-50 mt-1 min-w-48 border border-line bg-panel py-1 font-sans shadow-xl focus:outline-none"
      >
        <p className="truncate px-3 py-2 font-mono text-xs text-muted">{user.email}</p>
        {links.map((l) => (
          <MenuItem key={l.href}>
            <a href={l.href} className={ITEM}>
              {l.label}
            </a>
          </MenuItem>
        ))}
        <MenuItem>
          <a href="/account" className={ITEM}>
            Account
          </a>
        </MenuItem>
        <MenuItem>
          <button
            type="button"
            className={ITEM}
            onClick={() => void signOutAndLeave().catch(() => setFailed(true))}
          >
            Sign out
          </button>
        </MenuItem>
      </MenuItems>
      {failed && (
        <p role="alert" className="absolute right-0 mt-1 text-xs whitespace-nowrap text-down">
          Sign-out failed. Try again.
        </p>
      )}
    </Menu>
  );
}
