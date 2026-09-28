import { useState } from "react";
import { z } from "zod";
import { type AuthProviders, Email } from "@/shared/schemas/auth";
import { Button, Field, Notice } from "../admin/ui";
import { accountFailure, signInEmail, signInSocial } from "./client";
import { useSubmit } from "./form";

const SignInRequest = z.object({ email: Email, password: z.string().min(1, "Enter your password") });

const PROVIDER_LABEL = { github: "GitHub", google: "Google" } as const;

/**
 * Email and password, plus GitHub and Google when this instance enables them. After signing in the page
 * loads `next` (a same-origin path) as a full navigation, so every loader runs with the new session.
 */
export function SignIn({ providers, next }: { providers: AuthProviders; next: string }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [social, setSocial] = useState<string | null>(null);
  const { busy, failure, submit, at } = useSubmit(SignInRequest, async (req) => {
    await signInEmail(req.email, req.password);
    window.location.assign(next);
  });
  const oauth = (["github", "google"] as const).filter((p) => providers[p]);

  return (
    <div className="flex flex-col gap-5">
      {(failure || social) && <Notice tone="error">{social ?? failure?.message}</Notice>}
      <form
        noValidate
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(form);
        }}
      >
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          value={form.email}
          issues={at("email")}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          value={form.password}
          issues={at("password")}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
        />
        <Button type="submit" tone="primary" disabled={busy} className="mt-1">
          Sign in
        </Button>
      </form>
      {oauth.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          {oauth.map((p) => (
            <Button
              key={p}
              disabled={busy}
              onClick={() =>
                void signInSocial(p, next).catch((err: unknown) => setSocial(accountFailure(err).message))
              }
            >
              Continue with {PROVIDER_LABEL[p]}
            </Button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted">No account? Ask an owner or admin of this instance for an invite.</p>
    </div>
  );
}
