import { useState } from "react";
import { SOURCE_KINDS, type SourceKind } from "@/shared/model";
import { CreateSourceRequest, type IssuedKey, type SourceKeyList } from "@/shared/schemas/admin";
import { createSource, describeFailure, rotateKey } from "./client";
import { ago, secondsSince } from "./monitors/model";
import { SecretDialog } from "./SecretDialog";
import { SOURCE_KIND_NAME, sourceLabel } from "./settings/labels";
import { Panel } from "./settings/Section";
import { Button, Field, Notice, SelectField, when } from "./ui";

type Key = SourceKeyList["keys"][number];

/** When the source last reported: its data's time from the view, else the key's last use. */
function lastHeard(k: Key, lastSeen: ReadonlyMap<string, string | null> | undefined, now: string): string {
  const at = lastSeen?.get(k.source) ?? k.next?.lastUsedAt ?? k.current?.lastUsedAt ?? null;
  return at ? ago(secondsSince(at, now)) : "Never";
}

/** The key's state in words: when it was made, and a rotation waiting for its first use. */
function keyState(k: Key): string {
  if (!k.current && !k.next) return "No key";
  const parts: string[] = [];
  if (k.current) parts.push(`Made ${when(k.current.createdAt)}, last used ${when(k.current.lastUsedAt)}`);
  if (k.next) parts.push(`New key made ${when(k.next.createdAt)} takes over on its first use`);
  return parts.join(". ");
}

/**
 * Ingest keys per source (never their secrets), creating a source with its key, and rotation. A created or
 * rotated key's secret is held only while the one-time dialog is open. A key whose source was removed from
 * the config stays listed, marked "not in the config", so it can still be rotated.
 */
export function Sources({
  site,
  list,
  lastSeen,
  onReload,
}: {
  site: string;
  list: SourceKeyList;
  /** When each source's newest data was produced (the site view), by source id. */
  lastSeen?: ReadonlyMap<string, string | null>;
  onReload: () => void;
}) {
  const now = new Date().toISOString();
  const labels = list.keys.map((k) => sourceLabel(k.source));
  const rotateLabel = (k: Key, i: number) =>
    labels.filter((l) => l === labels[i]).length > 1
      ? `Rotate key ${k.keyId} for ${labels[i]}`
      : `Rotate key for ${labels[i]}`;
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
    <Panel title="Sources">
      <p className="mb-4 text-sm text-muted">
        Collectors, pushers and agents that report in. Each has its own key; rotate a key if it may have
        leaked.
      </p>
      {error && (
        <Notice tone="error" className="mb-4">
          {error}
        </Notice>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Sources and their keys</caption>
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-1 pr-3 font-normal">Source</th>
              <th className="py-1 pr-3 font-normal">Last heard from</th>
              <th className="py-1 pr-3 font-normal">Key</th>
              <th className="py-1 font-normal">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.keys.map((k, i) => (
              <tr key={k.keyId} className="border-t border-hair align-top">
                <td className="py-2 pr-3">
                  <span className="font-medium text-ink">{labels[i]}</span>
                  {!k.inConfig && (
                    <span className="block text-xs text-muted">
                      No longer in your setup; its key still works.
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap">{lastHeard(k, lastSeen, now)}</td>
                <td className="py-2 pr-3 text-xs text-muted">{keyState(k)}</td>
                <td className="py-2 text-right">
                  <Button
                    onClick={() => void act(k.keyId, () => rotateKey(site, k.keyId))}
                    disabled={busy !== null}
                    aria-label={rotateLabel(k, i)}
                  >
                    Rotate key
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.keys.length === 0 && <p className="py-2 text-sm text-muted">No sources report in yet.</p>}
      </div>

      <form
        className="mt-6 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <h4 className="text-sm font-semibold text-ink">Add a source</h4>
        <p className="mt-1 text-sm text-muted">
          Adds it to your setup (saved as a new revision) and makes its first key, shown once.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <SelectField
            label="Kind"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as SourceKind })}
          >
            {SOURCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {SOURCE_KIND_NAME[k]}
              </option>
            ))}
          </SelectField>
          <Field
            label="Name"
            placeholder="app-2"
            value={form.name}
            issues={at("source")}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <Field
            label="Key name"
            placeholder="facts-2"
            value={form.keyId}
            issues={at("keyId")}
            onChange={(e) => setForm({ ...form, keyId: e.target.value })}
          />
          <Field
            label="Reports every (seconds)"
            type="number"
            min={1}
            value={form.interval}
            issues={at("expectedIntervalS")}
            onChange={(e) => setForm({ ...form, interval: e.target.value })}
          />
        </div>
        <Button type="submit" tone="primary" className="mt-3" disabled={busy !== null}>
          Add source
        </Button>
      </form>

      <SecretDialog
        issued={issued}
        onClose={() => {
          setIssued(null);
          onReload();
        }}
      />
    </Panel>
  );
}
