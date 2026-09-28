import { useState } from "react";
import { z } from "zod";
import { AcceptInviteRequest, type InviteInfo } from "@/shared/schemas/auth";
import { Button, Field, Notice, when } from "../admin/ui";
import { acceptInvite } from "./client";
import { useSubmit } from "./form";

const AcceptForm = AcceptInviteRequest.extend({ confirm: z.string() }).refine(
  (f) => f.password === f.confirm,
  { message: "The passwords do not match", path: ["confirm"] },
);

/** Where a new user lands: admin for roles that have it, the status page for viewers. */
export const landingFor = (role: InviteInfo["role"]) => (role === "viewer" ? "/" : "/admin");

/**
 * Accepting an invite: name, email (fixed when the invite names one) and a password. The server creates
 * the account with the invite's role and signs it in; the page then loads where that role belongs.
 */
export function InviteAccept({ token, invite }: { token: string; invite: InviteInfo }) {
  const [form, setForm] = useState({ name: "", email: invite.email ?? "", password: "", confirm: "" });
  const { busy, failure, submit, at } = useSubmit(AcceptForm, async ({ confirm: _, ...req }) => {
    const me = await acceptInvite(token, req);
    window.location.assign(landingFor(me.user?.role ?? invite.role));
  });

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(form);
      }}
    >
      <p className="text-sm text-muted">
        You are invited as <strong className="font-semibold text-ink">{invite.role}</strong>. The invite
        expires {when(invite.expiresAt)}.
      </p>
      {failure && <Notice tone="error">{failure.message}</Notice>}
      <Field
        label="Name"
        autoComplete="name"
        value={form.name}
        issues={at("name")}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <Field
        label="Email"
        type="email"
        autoComplete="username"
        value={form.email}
        readOnly={invite.email !== null}
        issues={at("email")}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
      />
      <Field
        label="Password (at least 12 characters)"
        type="password"
        autoComplete="new-password"
        value={form.password}
        issues={at("password")}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
      />
      <Field
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={form.confirm}
        issues={at("confirm")}
        onChange={(e) => setForm({ ...form, confirm: e.target.value })}
      />
      <Button type="submit" tone="primary" disabled={busy} className="mt-1">
        Create account
      </Button>
    </form>
  );
}
