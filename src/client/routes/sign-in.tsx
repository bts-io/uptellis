import { createFileRoute, redirect } from "@tanstack/react-router";
import { getMe, safeNext } from "../lib/account/client";
import { AccountFrame } from "../lib/account/Frame";
import { SignIn } from "../lib/account/SignIn";

/** `/sign-in?next=<path>`: signed in already goes straight to `next`, a fresh instance to `/setup`. */
export const Route = createFileRoute("/sign-in")({
  // Kept as given; the loader only ever follows it through `safeNext`.
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({
    next: typeof s.next === "string" ? s.next : undefined,
  }),
  loaderDeps: ({ search }) => ({ next: safeNext(search.next) }),
  loader: async ({ deps }) => {
    const me = await getMe();
    if (me.setupNeeded) throw redirect({ href: "/setup" });
    if (me.user) throw redirect({ href: deps.next });
    return { providers: me.providers, next: deps.next };
  },
  head: () => ({ meta: [{ title: "Sign in | Uptellis" }] }),
  component: () => {
    const { providers, next } = Route.useLoaderData();
    return (
      <AccountFrame title="Sign in">
        <SignIn providers={providers} next={next} />
      </AccountFrame>
    );
  },
});
