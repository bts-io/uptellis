import { useState } from "react";
import { ROLES, type Role } from "@/shared/auth";
import {
  CreateInviteRequest,
  type InviteList,
  type IssuedInvite,
  type UserList,
  type UserListEntry,
  type UserSummary,
} from "@/shared/schemas/auth";
import { accountFailure, changeRole, createInvite, removeUser, revokeInvite } from "../account/client";
import { useSubmit } from "../account/form";
import { Panel } from "./settings/Section";
import { Button, ConfirmDialog, CopyField, Field, Modal, Notice, SelectField, when } from "./ui";

export const ROLE_NAME: Record<Role, string> = { owner: "Owner", admin: "Admin", viewer: "Viewer" };

const ROLE_HELP: Record<Role, string> = {
  owner: "everything, including instance settings",
  admin: "config, sources, keys and users",
  viewer: "sees private pages",
};

/**
 * Users and invites (`users.manage`): each user's role can be changed and a user removed (the server keeps
 * the last owner); an invite yields a one-time link, shown once with its expiry. Only an owner may grant
 * or touch the owner role, so admins are not offered it.
 */
export function Users({
  me,
  users,
  invites,
  onReload,
}: {
  me: UserSummary;
  users: UserList;
  invites: InviteList;
  onReload: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<UserListEntry | null>(null);
  const [issued, setIssued] = useState<IssuedInvite | null>(null);
  const isOwner = me.role === "owner";
  const grantable = ROLES.filter((r) => isOwner || r !== "owner");

  const act = async (id: string, work: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await work();
      onReload();
    } catch (err) {
      setError(accountFailure(err).message);
    } finally {
      setBusy(null);
    }
  };

  const [form, setForm] = useState<{ email: string; role: Role }>({ email: "", role: "viewer" });
  const invite = useSubmit(CreateInviteRequest, async (req) => {
    setIssued(await createInvite(req));
    setForm({ email: "", role: form.role });
  });
  const pending = invites.invites.filter((i) => i.status === "pending");

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="People"
        aside={
          <span className="text-xs text-muted">
            {users.users.length === 1 ? "1 person" : `${users.users.length} people`}
          </span>
        }
      >
        {error && (
          <Notice tone="error" className="mb-4">
            {error}
          </Notice>
        )}
        <ul className="flex flex-col">
          {users.users.map((u) => {
            const self = u.id === me.id;
            const locked = !isOwner && u.role === "owner";
            return (
              <li
                key={u.id}
                className="grid gap-3 border-t border-hair py-3 first:border-t-0 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {u.name}
                    {self && <span className="text-muted"> (you)</span>}
                  </p>
                  <p className="truncate font-mono text-xs text-muted">{u.email}</p>
                  <p className="text-xs text-faint">
                    Joined {when(u.createdAt)}, last sign-in {when(u.lastSignInAt)}
                  </p>
                </div>
                <SelectField
                  label={`Role of ${u.name}`}
                  value={u.role}
                  disabled={locked || busy !== null}
                  onChange={(e) => void act(u.id, () => changeRole(u.id, e.target.value as Role))}
                >
                  {(locked ? ROLES : grantable).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_NAME[r]}
                    </option>
                  ))}
                </SelectField>
                <Button
                  tone="danger"
                  disabled={locked || busy !== null}
                  aria-label={`Remove ${u.name}`}
                  onClick={() => setRemoving(u)}
                >
                  Remove
                </Button>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-muted">
          {grantable.map((r) => `${ROLE_NAME[r]}: ${ROLE_HELP[r]}`).join("; ")}. The last owner cannot be
          demoted or removed.
        </p>
      </Panel>

      <Panel title="Invites">
        <p className="mb-3 text-sm text-muted">
          An invite is a link that works once. Send it to the person yourself.
        </p>
        <form
          noValidate
          className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void invite.submit({ role: form.role, email: form.email.trim() || undefined });
          }}
        >
          <Field
            label="Email (optional: only this address may accept)"
            type="email"
            value={form.email}
            issues={invite.at("email")}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <SelectField
            label="Role"
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
          >
            {grantable.map((r) => (
              <option key={r} value={r}>
                {ROLE_NAME[r]}
              </option>
            ))}
          </SelectField>
          <Button type="submit" tone="primary" disabled={invite.busy}>
            Create invite
          </Button>
        </form>
        {invite.failure && (
          <Notice tone="error" className="mt-3">
            {invite.failure.message}
          </Notice>
        )}
        <h4 className="mt-6 text-sm font-semibold text-ink">Waiting to be accepted</h4>
        {pending.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No open invites.</p>
        ) : (
          <ul className="mt-1 flex flex-col">
            {pending.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-hair py-2 first:border-t-0"
              >
                <span className="text-sm">
                  {ROLE_NAME[i.role]}
                  <span className="text-muted"> for {i.email ?? "anyone with the link"}</span>
                  <span className="block text-xs text-faint">expires {when(i.expiresAt)}</span>
                </span>
                <Button
                  disabled={busy !== null}
                  aria-label={`Revoke the ${i.role} invite for ${i.email ?? "anyone"}`}
                  onClick={() => void act(i.id, () => revokeInvite(i.id))}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.name ?? "user"}?`}
        confirm="Remove user"
        busy={busy !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          const u = removing;
          setRemoving(null);
          if (u) void act(u.id, () => removeUser(u.id));
        }}
      >
        {removing?.email} loses access at once and their sessions end. They can come back only with a new
        invite.
      </ConfirmDialog>

      <Modal
        open={issued !== null}
        onClose={() => {
          setIssued(null);
          onReload();
        }}
        title="Invite link"
      >
        {issued && (
          <div className="flex flex-col gap-3 text-sm">
            <Notice tone="warn">
              This link is shown once and works once. Copy it now and send it to the person you invite.
            </Notice>
            <p className="text-muted">
              Role {ROLE_NAME[issued.role]}
              {issued.email ? `, for ${issued.email}` : ""}. Expires {when(issued.expiresAt)}.
            </p>
            <CopyField label="Invite link" value={issued.url} copyLabel="Copy link" />
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setIssued(null);
                  onReload();
                }}
              >
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
