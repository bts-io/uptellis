import { useState } from "react";
import type { z } from "zod";
import { type AccountFailure, accountFailure } from "./client";

/** Zod issues with dotted paths, the shape the API answers. */
export const issuesOf = (error: z.ZodError): AccountFailure["issues"] =>
  error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));

/**
 * A form's submit: validates with `schema` first (nothing is sent while a field is wrong), then runs
 * `work`; `failure` holds the message and field issues of whichever step refused.
 */
export function useSubmit<T>(schema: z.ZodType<T>, work: (value: T) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AccountFailure | null>(null);
  const submit = async (input: unknown) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      setFailure({ message: "Check the highlighted fields.", issues: issuesOf(parsed.error) });
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await work(parsed.data);
    } catch (err) {
      setFailure(accountFailure(err));
    } finally {
      setBusy(false);
    }
  };
  const at = (path: string) => failure?.issues.filter((i) => i.path === path) ?? [];
  return { busy, failure, submit, at, clear: () => setFailure(null) };
}
