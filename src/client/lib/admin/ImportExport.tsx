import { useState } from "react";
import type { ImportResult } from "@/shared/schemas/admin";
import { describeFailure, exportHref, importConfig } from "./client";
import { Panel } from "./settings/Section";
import { Button, DiffTable, Notice } from "./ui";

/** Download the config as `sites/<slug>.json`; upload a file, see its dry-run diff, then confirm the import. */
export function ImportExport({ site, onReload }: { site: string; onReload: () => void }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const pick = async (f: File | undefined) => {
    setCheck(null);
    setMessage(null);
    if (!f) return setFile(null);
    const text = await f.text();
    setFile({ name: f.name, text });
    setBusy(true);
    try {
      setCheck(await importConfig(site, text, true));
    } catch (err) {
      setMessage({ tone: "error", text: describeFailure(err).message });
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await importConfig(site, file.text, false);
      if (!r.valid) setCheck(r);
      else {
        setMessage({
          tone: "ok",
          text: r.version ? `Imported as version ${r.version}.` : "Nothing to import.",
        });
        setFile(null);
        setCheck(null);
        onReload();
      }
    } catch (err) {
      setMessage({ tone: "error", text: describeFailure(err).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Panel title="Export">
        <div>
          <p className="text-sm text-muted">
            Your whole saved setup as one file: keep it as a backup, or in git at{" "}
            <span className="font-mono">sites/{site}.json</span>.
          </p>
          <a
            href={exportHref(site)}
            download={`${site}.json`}
            className="mt-2 inline-flex border border-line px-3 py-1.5 text-sm text-ink hover:bg-raised"
          >
            Download {site}.json
          </a>
        </div>
      </Panel>

      <Panel title="Import">
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-sm text-muted">
              Load a file exported here before. We show what would change; nothing is saved until you confirm.
            </p>
            <label htmlFor="import-file" className="mt-2 block text-xs text-muted">
              Config file
            </label>
            <input
              id="import-file"
              type="file"
              accept=".json,application/json"
              onChange={(e) => void pick(e.target.files?.[0])}
              className="mt-1 block w-full text-sm text-ink file:mr-3 file:border file:border-line file:bg-raised file:px-3 file:py-1.5 file:text-ink"
            />
          </div>

          {message && <Notice tone={message.tone}>{message.text}</Notice>}
          {file && check && !check.valid && (
            <Notice tone="error">
              {file.name} is not a valid config:
              <ul className="mt-1 text-xs">
                {check.issues.map((i) => (
                  <li key={i.path + i.message}>
                    <span className="font-mono">{i.path || "(root)"}</span>: {i.message}
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          {file && check?.valid && (
            <div className="flex flex-col gap-3">
              <h4 className="text-sm font-semibold text-ink">What {file.name} would change</h4>
              <DiffTable diff={check.diff} />
              <div className="flex flex-wrap gap-2">
                <Button
                  tone="primary"
                  onClick={() => void confirm()}
                  disabled={busy || check.diff.length === 0}
                >
                  Import {file.name}
                </Button>
                <Button onClick={() => void pick(undefined)}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
