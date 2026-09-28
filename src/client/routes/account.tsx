import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { AccountMenu } from "../lib/account/AccountMenu";
import { AccountSettings } from "../lib/account/AccountSettings";
import { getMe } from "../lib/account/client";

/** The signed-in user's own account (every role); signed out goes to sign-in and back. */
export const Route = createFileRoute("/account")({
  loader: async () => {
    const me = await getMe();
    if (!me.user) throw redirect({ href: "/sign-in?next=%2Faccount" });
    return { user: me.user, admin: me.permissions.includes("config.edit") };
  },
  head: () => ({ meta: [{ title: "Account | Uptellis" }] }),
  component: AccountPage,
});

function AccountPage() {
  const { user, admin } = Route.useLoaderData();
  const router = useRouter();
  return (
    <div className="min-h-dvh bg-base font-sans text-ink">
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <h1 className="text-lg font-semibold">Account</h1>
          <AccountMenu
            user={user}
            links={[
              { href: "/", label: "Status page" },
              ...(admin ? [{ href: "/admin", label: "Admin" }] : []),
            ]}
          />
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <AccountSettings user={user} onSaved={() => void router.invalidate()} />
      </main>
    </div>
  );
}
