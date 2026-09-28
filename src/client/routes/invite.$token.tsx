import { createFileRoute } from "@tanstack/react-router";
import { getInvite } from "../lib/account/client";
import { AccountFrame } from "../lib/account/Frame";
import { InviteAccept } from "../lib/account/InviteAccept";
import { ApiError } from "../lib/api";

/** `/invite/<token>`: the invite's role and expiry, then the account form. A used or expired link says so. */
export const Route = createFileRoute("/invite/$token")({
  loader: async ({ params }) => ({
    invite: await getInvite(params.token).catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }),
  }),
  head: () => ({ meta: [{ title: "Invite | Uptellis" }, { name: "referrer", content: "no-referrer" }] }),
  component: () => {
    const { token } = Route.useParams();
    const { invite } = Route.useLoaderData();
    return invite ? (
      <AccountFrame title="Join Uptellis">
        <InviteAccept token={token} invite={invite} />
      </AccountFrame>
    ) : (
      <AccountFrame title="This invite cannot be used">
        <p className="text-sm text-muted">
          The link is unknown, already used or expired. Ask whoever invited you for a new one.
        </p>
      </AccountFrame>
    );
  },
});
