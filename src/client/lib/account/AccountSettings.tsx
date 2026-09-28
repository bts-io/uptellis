import { useState } from "react";
import { z } from "zod";
import { DisplayName, Password, type UserSummary } from "@/shared/schemas/auth";
import { Button, Card, Field, Notice } from "../admin/ui";
import { changePassword, updateName } from "./client";
import { useSubmit } from "./form";

const NameForm = z.object({ name: DisplayName });
const PasswordForm = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    password: Password,
    confirm: z.string(),
  })
  .refine((f) => f.password === f.confirm, { message: "The passwords do not match", path: ["confirm"] });

/** The signed-in user's own account: display name and password (changing it signs out other sessions). */
export function AccountSettings({ user, onSaved }: { user: UserSummary; onSaved: () => void }) {
  const [name, setName] = useState(user.name);
  const [nameDone, setNameDone] = useState(false);
  const rename = useSubmit(NameForm, async (f) => {
    await updateName(f.name);
    setNameDone(true);
    onSaved();
  });

  const empty = { current: "", password: "", confirm: "" };
  const [pw, setPw] = useState(empty);
  const [pwDone, setPwDone] = useState(false);
  const repass = useSubmit(PasswordForm, async (f) => {
    await changePassword(f.current, f.password);
    setPw(empty);
    setPwDone(true);
  });

  return (
    <div className="flex flex-col gap-6">
      <Card title="Profile" aside={<span className="text-xs text-muted">{user.role}</span>}>
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setNameDone(false);
            void rename.submit({ name });
          }}
        >
          {rename.failure && <Notice tone="error">{rename.failure.message}</Notice>}
          {nameDone && <Notice tone="ok">Name saved.</Notice>}
          <p className="text-sm text-muted">
            Signed in as <span className="font-mono text-ink">{user.email}</span>
          </p>
          <Field
            label="Name"
            autoComplete="name"
            value={name}
            issues={rename.at("name")}
            onChange={(e) => setName(e.target.value)}
          />
          <div>
            <Button type="submit" tone="primary" disabled={rename.busy || name === user.name}>
              Save name
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Password">
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setPwDone(false);
            void repass.submit(pw);
          }}
        >
          {repass.failure && <Notice tone="error">{repass.failure.message}</Notice>}
          {pwDone && <Notice tone="ok">Password changed. Other sessions were signed out.</Notice>}
          <Field
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={pw.current}
            issues={repass.at("current")}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
          />
          <Field
            label="New password (at least 12 characters)"
            type="password"
            autoComplete="new-password"
            value={pw.password}
            issues={repass.at("password")}
            onChange={(e) => setPw({ ...pw, password: e.target.value })}
          />
          <Field
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={pw.confirm}
            issues={repass.at("confirm")}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
          />
          <div>
            <Button type="submit" tone="primary" disabled={repass.busy}>
              Change password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
