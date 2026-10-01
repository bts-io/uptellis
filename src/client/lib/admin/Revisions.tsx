import { useState } from "react";
import type { RevisionList } from "@/shared/schemas/admin";
import { describeFailure, restoreRevision } from "./client";
import { Panel } from "./settings/Section";
import { Button, ConfirmDialog, Notice, when } from "./ui";

/** Every saved revision, newest first, with Restore (which saves the old config as a new revision). */
export function Revisions({
  site,
  list,
  onReload,
}: {
  site: string;
  list: RevisionList;
  onReload: () => void;
}) {
  const [target, setTarget] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const revisions = [...list.revisions].sort((a, b) => b.version - a.version);

  const restore = async (version: number) => {
    setBusy(true);
    try {
      const saved = await restoreRevision(site, version);
      setMessage({ tone: "ok", text: `Restored version ${version} as version ${saved.version}.` });
      onReload();
    } catch (err) {
      setMessage({ tone: "error", text: describeFailure(err).message });
    } finally {
      setBusy(false);
      setTarget(null);
    }
  };

  return (
    <Panel
      title="History"
      aside={<span className="text-xs text-muted">Live now: version {list.current}</span>}
    >
      {message && (
        <Notice tone={message.tone} className="mb-4">
          {message.text}
        </Notice>
      )}
      <ul className="flex flex-col" aria-label="Saved versions, newest first">
        {revisions.map((r) => (
          <li
            key={r.version}
            data-revision={r.version}
            className="flex flex-wrap items-center justify-between gap-2 border-t border-hair py-2.5 first:border-t-0"
          >
            <div className="min-w-0">
              <p className="text-sm text-ink">
                {r.note ?? "Saved without a note"}
                {r.version === list.current && <span className="ml-2 text-xs text-up">live now</span>}
              </p>
              <p className="text-xs text-muted">
                Version {r.version}, by {r.savedBy}, {when(r.savedAt)}.{" "}
                {r.changes === 1 ? "1 change" : `${r.changes} changes`}
              </p>
            </div>
            {r.version !== list.current && (
              <Button onClick={() => setTarget(r.version)} aria-label={`Restore version ${r.version}`}>
                Restore
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={target !== null}
        title={`Restore version ${target ?? ""}?`}
        confirm="Restore"
        busy={busy}
        onClose={() => setTarget(null)}
        onConfirm={() => target !== null && void restore(target)}
      >
        Your setup goes back to how it was in version {target}, saved as a new version {list.current + 1}.
        Nothing is lost: version {list.current} stays in the list.
      </ConfirmDialog>
    </Panel>
  );
}
