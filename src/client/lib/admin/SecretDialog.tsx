import type { IssuedKey } from "@/shared/schemas/admin";
import { sourceLabel } from "./settings/labels";
import { Button, CopyField, Modal, Notice } from "./ui";

/**
 * The one-time secret of a created or rotated key. The caller holds the `IssuedKey` only while this is open
 * and drops it on close, so the secret leaves memory with the dialog; nothing is stored anywhere.
 */
export function SecretDialog({ issued, onClose }: { issued: IssuedKey | null; onClose: () => void }) {
  return (
    <Modal open={issued !== null} onClose={onClose} title="New key">
      {issued && (
        <div className="flex flex-col gap-3 text-sm">
          <Notice tone="warn">
            This secret is shown once. Copy it now: it cannot be shown again. Closing this dialog discards it.
          </Notice>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">Source</dt>
            <dd>{sourceLabel(issued.source)}</dd>
            <dt className="text-muted">Key name</dt>
            <dd className="font-mono">{issued.keyId}</dd>
            <dt className="text-muted">Works</dt>
            <dd>
              {issued.slot === "next"
                ? "From its first use; the old key keeps working until then."
                : "From now on."}
            </dd>
          </dl>
          <CopyField label="Secret" value={issued.secret} copyLabel="Copy secret" />
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
