import { createFileRoute, getRouteApi, notFound, useRouter } from "@tanstack/react-router";
import { getInvites, getUsers } from "../../../lib/account/client";
import { orNotFound } from "../../../lib/admin/client";
import { SettingsSection } from "../../../lib/admin/settings/Section";
import { Users } from "../../../lib/admin/Users";

const admin = getRouteApi("/admin");

export const Route = createFileRoute("/admin/settings/users")({
  loader: async () => {
    const [users, invites] = await Promise.all([getUsers(), getInvites()]).catch(orNotFound);
    return { users, invites };
  },
  component: () => {
    const { me } = admin.useLoaderData();
    const { users, invites } = Route.useLoaderData();
    const router = useRouter();
    if (!me.user) throw notFound();
    return (
      <SettingsSection
        title="Users and invites"
        subtitle="People who can sign in to this admin, and what they may do."
      >
        <Users me={me.user} users={users} invites={invites} onReload={() => void router.invalidate()} />
      </SettingsSection>
    );
  },
});
