import { useState } from "react";
import type { IssuedKey } from "@/shared/schemas/admin";
import { Button, Modal, Notice } from "./ui";

/**
 * The one-time secret of a created or rotated key. The caller holds the `IssuedKey` only while this is open
 * and drops it on close, so the secret leaves memory with the dialog; nothing is stored anywhere.
 */
export function SecretDialog({ issued, onClose }: { issued: IssuedKey | null; onClose: () => void }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const close = () => {
    setCopied(null);
    onClose();
  };
  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Modal open={issued !== null} onClose={close} title="New ingest key">
      {issued && (
        <div className="flex flex-col gap-3 text-sm">
          <Notice tone="warn">
            This secret is shown once. Copy it now: it cannot be shown again. Closing this dialog discards it.
          </Notice>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">Key id</dt>
            <dd className="font-mono">{issued.keyId}</dd>
            <dt className="text-muted">Source</dt>
            <dd className="font-mono">{issued.source}</dd>
            <dt className="text-muted">Slot</dt>
            <dd>
              {issued.slot}
              {issued.slot === "next" && (
                <span className="text-muted">
                  {" "}
                  (becomes current on its first ingest; the old key works until then)
                </span>
              )}
            </dd>
          </dl>
          <label htmlFor="issued-secret" className="text-xs text-muted">
            Secret
          </label>
          <input
            id="issued-secret"
            readOnly
            value={issued.secret}
            onFocus={(e) => e.target.select()}
            className="w-full border border-line bg-base px-2 py-1.5 font-mono text-xs text-ink"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button tone="primary" onClick={() => void copy()}>
              Copy secret
            </Button>
            <Button onClick={close}>Done</Button>
            <span role="status" className="text-xs text-muted">
              {copied === true
                ? "Copied."
                : copied === false
                  ? "Copy failed: select the text and copy it."
                  : ""}
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}
