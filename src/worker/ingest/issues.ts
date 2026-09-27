/**
 * Payload rejections (422) that name field paths, never values. Zod messages in this repo carry no input
 * values; as a second guard every message and path segment is checked before it leaves the Worker.
 */
import type { z } from "zod";
import { containsForbiddenLiteral } from "@/shared/model";

export interface PayloadIssue {
  /** Dotted path into the request body, e.g. `monitors.2.name`. */
  path: string;
  message: string;
}

export const MAX_ISSUES = 50;

export class PayloadRejected extends Error {
  readonly issues: PayloadIssue[];
  constructor(issues: PayloadIssue[]) {
    super("Payload rejected");
    this.name = "PayloadRejected";
    this.issues = issues.slice(0, MAX_ISSUES);
  }
}

const SAFE_SEGMENT = /^[A-Za-z0-9_]{1,64}$/;

/** Path segments that could echo input (record keys) are replaced by `*` unless they are plain identifiers. */
export function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(body)";
  return path
    .map((seg) =>
      typeof seg === "number" ? String(seg) : typeof seg === "string" && SAFE_SEGMENT.test(seg) ? seg : "*",
    )
    .join(".");
}

const safeMessage = (message: string, code: string) =>
  message.length > 200 || containsForbiddenLiteral(message) ? `Invalid value (${code})` : message;

export function issue(path: readonly PropertyKey[], message: string): PayloadIssue {
  return { path: formatPath(path), message: safeMessage(message, "custom") };
}

export function zodIssues(error: z.ZodError): PayloadIssue[] {
  return error.issues
    .slice(0, MAX_ISSUES)
    .map((i) => ({ path: formatPath(i.path), message: safeMessage(i.message, i.code) }));
}
