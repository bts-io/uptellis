import { useState } from "react";
import { SOURCE_KINDS, type SourceKind } from "@/shared/model";
import { CreateSourceRequest, type IssuedKey, type SourceKeyList } from "@/shared/schemas/admin";
import { createSource, describeFailure, rotateKey } from "./client";
import { SecretDialog } from "./SecretDialog";
import { Button, Card, Field, Notice, SelectField, when } from "./ui";

function Slot({ slot }: { slot: SourceKeyList["keys"][number]["current"] }) {
  if (!slot) return <span className="text-faint">none</span>;
  return (
    <span className="whitespace-nowrap">
      created {when(slot.createdAt)}
      <br />
      <span className="text-muted">last used {when(slot.lastUsedAt)}</span>
    </span>
  );
}

/**
 * Ingest keys per source (never their secrets), creating a source with its key, and rotation. A created or
 * rotated key's secret is held only while the one-time dialog is open. A key whose source was removed from
 * the config stays listed, marked "not in the config", so it can still be rotated.
 */
export function Sources({
  site,
  list,
  onReload,
}: {
  site: string;
  list: SourceKeyList;
  onReload: () => void;
}) {
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ keyId: "", kind: "kuma" as SourceKind, name: "", interval: "60" });
  const [formIssues, setFormIssues] = useState<{ path: string; message: string }[]>([]);

  /** Runs a create or rotate; true once the new key's dialog is open. */
  const act = async (id: string, work: () => Promise<IssuedKey>): Promise<boolean> => {
    setBusy(id);
    setError(null);
    try {
      setIssued(await work());
      return true;
    } catch (err) {
      setError(describeFailure(err).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const create = () => {
    const req = CreateSourceRequest.safeParse({
      keyId: form.keyId,
      source: `${form.kind}:${form.name}`,
      kind: form.kind,
      expectedIntervalS: Number(form.interval),
    });
    if (!req.success) {
      setFormIssues(req.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
      return;
    }
    setFormIssues([]);
    void act("create", () => createSource(site, req.data)).then(
      (ok) => ok && setForm((f) => ({ ...f, keyId: "", name: "" })),
    );
  };
  const at = (path: string) => formIssues.filter((i) => i.path === path);

  return (
    <Card title="Sources and keys">
      {error && (
        <Notice tone="error" className="mb-4">
          {error}
        </Notice>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 pr-3 font-normal">Key id</th>
              <th className="py-1 pr-3 font-normal">Source</th>
              <th className="py-1 pr-3 font-normal">Store</th>
              <th className="py-1 pr-3 font-normal">Current</th>
              <th className="py-1 pr-3 font-normal">Next</th>
              <th className="py-1 font-normal">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.keys.map((k) => (
              <tr key={k.keyId} className="border-t border-hair align-top">
                <td className="py-2 pr-3 font-mono">{k.keyId}</td>
                <td className="py-2 pr-3">
                  <span className="font-mono">{k.source}</span>
                  {!k.inConfig && <span className="ml-2 text-xs text-muted">not in the config</span>}
                </td>
                <td className="py-2 pr-3">{k.store}</td>
                <td className="py-2 pr-3 text-xs">
                  <Slot slot={k.current} />
                </td>
                <td className="py-2 pr-3 text-xs">
                  <Slot slot={k.next} />
                </td>
                <td className="py-2 text-right">
                  <Button
                    onClick={() => void act(k.keyId, () => rotateKey(site, k.keyId))}
                    disabled={busy !== null}
                    aria-label={`Rotate ${k.keyId}`}
                  >
                    Rotate
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.keys.length === 0 && <p className="py-2 text-sm text-muted">No keys yet.</p>}
      </div>

      <form
        className="mt-6 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <h3 className="text-sm font-semibold">Create source</h3>
        <p className="mt-1 text-sm text-muted">
          Adds the source to the config (a new revision) and issues its first key.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field
            label="Key id"
            placeholder="facts-2"
            value={form.keyId}
            issues={at("keyId")}
            onChange={(e) => setForm({ ...form, keyId: e.target.value })}
          />
          <SelectField
            label="Kind"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as SourceKind })}
          >
            {SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </SelectField>
          <Field
            label={`Source name (${form.kind}:name)`}
            placeholder="app-2"
            value={form.name}
            issues={at("source")}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Field
            label="Expected interval (s)"
            type="number"
            min={1}
            value={form.interval}
            issues={at("expectedIntervalS")}
            onChange={(e) => setForm({ ...form, interval: e.target.value })}
          />
        </div>
        <Button type="submit" tone="primary" className="mt-3" disabled={busy !== null}>
          Create source
        </Button>
      </form>

      <SecretDialog
        issued={issued}
        onClose={() => {
          setIssued(null);
          onReload();
        }}
      />
    </Card>
  );
}
