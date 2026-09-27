import { useState } from "react";
import type { RevisionList } from "@/shared/schemas/admin";
import { describeFailure, restoreRevision } from "./client";
import { Button, Card, ConfirmDialog, Notice, when } from "./ui";

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
    <Card
      title="Revisions"
      aside={<span className="text-xs text-muted">current: version {list.current}</span>}
    >
      {message && (
        <Notice tone={message.tone} className="mb-4">
          {message.text}
        </Notice>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 pr-3 font-normal">Version</th>
              <th className="py-1 pr-3 font-normal">When</th>
              <th className="py-1 pr-3 font-normal">By</th>
              <th className="py-1 pr-3 font-normal">Note</th>
              <th className="py-1 pr-3 font-normal">Changes</th>
              <th className="py-1 font-normal">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {revisions.map((r) => (
              <tr key={r.version} className="border-t border-hair align-top">
                <td className="py-2 pr-3 font-mono">
                  {r.version}
                  {r.version === list.current && <span className="ml-2 text-xs text-up">current</span>}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">{when(r.savedAt)}</td>
                <td className="py-2 pr-3">{r.savedBy}</td>
                <td className="py-2 pr-3 text-muted">{r.note ?? ""}</td>
                <td className="py-2 pr-3 font-mono">{r.changes}</td>
                <td className="py-2 text-right">
                  {r.version !== list.current && (
                    <Button onClick={() => setTarget(r.version)} aria-label={`Restore version ${r.version}`}>
                      Restore
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={target !== null}
        title={`Restore version ${target ?? ""}?`}
        confirm="Restore"
        busy={busy}
        onClose={() => setTarget(null)}
        onConfirm={() => target !== null && void restore(target)}
      >
        The config of version {target} becomes the live config as version {list.current + 1}. Nothing is lost:
        version {list.current} stays in the list.
      </ConfirmDialog>
    </Card>
  );
}
