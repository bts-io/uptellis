/**
 * The one save path of the admin: every change a page makes to the site config goes through here, so a
 * saved config is exactly what the full editor would save (the loaded `SiteConfig` with the change applied,
 * checked with the same `validateConfig`, sent through `saveConfig` against the version it started from).
 *
 *   const cfg = useSiteConfig({ site, state, onReload });
 *   const out = await cfg.save((c) => ({ ...c, monitors: [...c.monitors, monitor] }), "Added monitor Checkout");
 *   if (out.ok) toast("Added monitor Checkout"); else toast(out.message, "error");
 *
 * - `change` is a pure function of the latest config (never of a stale copy), so two quick saves in a row
 *   both land: after a save the hook keeps the saved config and its new version until the reload arrives.
 * - `note` is the plain sentence the revision list shows ("Paused API health"); longer than 200 characters
 *   it is cut.
 * - A 409 (someone else saved meanwhile) reloads the page's data and answers `reason: "conflict"` with a
 *   plain message; nothing of the change is saved. Invalid changes answer `reason: "invalid"` with the
 *   schema's issues (dotted paths, as the editor shows them) and never reach the server.
 *
 * `applyChange` and `saveChange` are the same steps without React, for tests and one-off callers.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SiteConfig } from "@/shared/config";
import type { ConfigIssue, ConfigState } from "@/shared/schemas/admin";
import { validateConfig } from "./ConfigEditor";
import { describeFailure, saveConfig } from "./client";

export type ConfigChange = (config: SiteConfig) => SiteConfig;

export type SaveOutcome =
  | { ok: true; version: number; config: SiteConfig }
  | { ok: false; reason: "invalid"; message: string; issues: ConfigIssue[] }
  | { ok: false; reason: "conflict"; message: string; issues: [] }
  | { ok: false; reason: "failed"; message: string; issues: ConfigIssue[] };

export const CONFLICT_MESSAGE =
  "Someone else saved a change a moment ago, so this one was not saved. The page now shows what is saved: check it and try again.";

const NOTE_MAX = 200;

/** The config with `change` applied, or the issues that stop it from being saved. */
export function applyChange(
  config: SiteConfig,
  change: ConfigChange,
): { ok: true; config: SiteConfig } | { ok: false; issues: ConfigIssue[] } {
  const next = change(config);
  const issues = validateConfig(next);
  return issues.length ? { ok: false, issues } : { ok: true, config: next };
}

/** Applies, checks and saves one change against `base.version`. */
export async function saveChange(
  site: string,
  base: { config: SiteConfig; version: number },
  change: ConfigChange,
  note: string,
): Promise<SaveOutcome> {
  const applied = applyChange(base.config, change);
  if (!applied.ok) {
    return {
      ok: false,
      reason: "invalid",
      message: `This could not be saved: ${applied.issues[0]?.message ?? "the change is not valid"}.`,
      issues: applied.issues,
    };
  }
  try {
    const res = await saveConfig(site, applied.config, base.version, note.trim().slice(0, NOTE_MAX));
    return { ok: true, version: res.version, config: applied.config };
  } catch (err) {
    const f = describeFailure(err);
    if (f.conflictVersion !== null)
      return { ok: false, reason: "conflict", message: CONFLICT_MESSAGE, issues: [] };
    if (f.issues.length) return { ok: false, reason: "invalid", message: f.message, issues: f.issues };
    return { ok: false, reason: "failed", message: f.message, issues: [] };
  }
}

export interface SiteConfigApi {
  /** The latest config this page knows (saved by this page, or loaded). */
  config: SiteConfig;
  version: number;
  /** True while a save is in flight. */
  saving: boolean;
  save: (change: ConfigChange, note: string) => Promise<SaveOutcome>;
}

export function useSiteConfig({
  site,
  state,
  onReload,
}: {
  site: string;
  /** The loaded config state (the `/admin` loader's `state`). */
  state: ConfigState;
  /** Reloads the page's data (router.invalidate()). */
  onReload: () => void;
}): SiteConfigApi {
  const [current, setCurrent] = useState({ config: state.config, version: state.version });
  const [saving, setSaving] = useState(false);
  const latest = useRef(current);
  latest.current = current;

  // A newer loaded version replaces what this page holds (never an older one still in flight).
  useEffect(() => {
    if (state.version >= latest.current.version) setCurrent({ config: state.config, version: state.version });
  }, [state.config, state.version]);

  const reload = useRef(onReload);
  reload.current = onReload;

  const save = useCallback(
    async (change: ConfigChange, note: string) => {
      setSaving(true);
      try {
        const out = await saveChange(site, latest.current, change, note);
        if (out.ok) {
          latest.current = { config: out.config, version: out.version };
          setCurrent(latest.current);
          reload.current();
        } else if (out.reason === "conflict") {
          reload.current();
        }
        return out;
      } finally {
        setSaving(false);
      }
    },
    [site],
  );

  return { config: current.config, version: current.version, saving, save };
}
