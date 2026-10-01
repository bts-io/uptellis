import { useState } from "react";
import { API_KEY_SCOPES, type ApiKeyScope } from "@/shared/auth";
import {
  type ApiKeyList,
  type ApiKeySummary,
  CreateApiKeyRequest,
  type IssuedApiKey,
} from "@/shared/schemas/auth";
import { accountFailure, createApiKey, revokeApiKey } from "../account/client";
import { useSubmit } from "../account/form";
import { Panel } from "./settings/Section";
import { Button, ConfirmDialog, CopyField, Field, Modal, Notice, when } from "./ui";

const SCOPE_NAME: Record<ApiKeyScope, string> = {
  ingest: "Send data",
  read: "Read data",
  agent: "Run checks",
};

const SCOPE_HELP: Record<ApiKeyScope, string> = {
  ingest: "push data as a source of this site",
  read: "read this site's page data and API",
  agent: "run this site's monitors as an agent (uptellis-agent)",
};

const scopeNames = (scopes: readonly ApiKeyScope[]) => scopes.map((s) => SCOPE_NAME[s]).join(", ");

/**
 * API keys of this site (`sources.manage`) for pushers and agents: create with a label and scopes (the key
 * is shown once, the caller holds it only while the dialog is open), list with last use, revoke.
 */
export function ApiKeys({ site, list, onReload }: { site: string; list: ApiKeyList; onReload: () => void }) {
  const [form, setForm] = useState<{ name: string; scopes: ApiKeyScope[] }>({ name: "", scopes: ["ingest"] });
  const [issued, setIssued] = useState<IssuedApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKeySummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = useSubmit(CreateApiKeyRequest, async (req) => {
    setIssued(await createApiKey(site, req));
    setForm({ name: "", scopes: ["ingest"] });
  });
  const close = () => {
    setIssued(null);
    onReload();
  };
  const revoke = async (key: ApiKeySummary) => {
    setBusy(true);
    setError(null);
    try {
      await revokeApiKey(site, key.id);
      onReload();
    } catch (err) {
      setError(accountFailure(err).message);
    } finally {
      setBusy(false);
    }
  };
  const active = list.keys.filter((k) => !k.revokedAt);
  const revoked = list.keys.filter((k) => k.revokedAt);

  return (
    <Panel title="API keys">
      <p className="mb-4 text-sm text-muted">
        For scripts, pushers and agents of this site only. They send the key as{" "}
        <code className="font-mono text-ink">Authorization: Bearer</code>.
      </p>
      {error && (
        <Notice tone="error" className="mb-4">
          {error}
        </Notice>
      )}
      {active.length === 0 ? (
        <p className="text-sm text-muted">No API keys yet.</p>
      ) : (
        <ul className="flex flex-col">
          {active.map((k) => (
            <li
              key={k.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-hair py-2 first:border-t-0"
            >
              <span className="min-w-0 text-sm">
                {k.name} <span className="font-mono text-xs text-muted">starts {k.prefix}</span>
                <span className="block text-xs text-faint">
                  Can: {scopeNames(k.scopes)}. Made {when(k.createdAt)}, last used {when(k.lastUsedAt)}
                </span>
              </span>
              <Button
                tone="danger"
                disabled={busy}
                aria-label={`Revoke ${k.name}`}
                onClick={() => setRevoking(k)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      {revoked.length > 0 && (
        <p className="mt-2 text-xs text-faint">
          Revoked: {revoked.map((k) => `${k.name} (${when(k.revokedAt)})`).join(", ")}
        </p>
      )}

      <form
        noValidate
        className="mt-6 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void create.submit({ name: form.name, scopes: form.scopes });
        }}
      >
        <h4 className="text-sm font-semibold text-ink">Create an API key</h4>
        {create.failure && (
          <Notice tone="error" className="mt-3">
            {create.failure.message}
          </Notice>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field
            label="Label"
            placeholder="facts pusher on app-2"
            value={form.name}
            issues={create.at("name")}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <fieldset aria-describedby="scope-issues">
            <legend className="text-xs text-muted">What it can do</legend>
            <div className="mt-1 flex flex-wrap gap-4">
              {API_KEY_SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-2 py-1.5 text-sm" title={SCOPE_HELP[s]}>
                  <input
                    type="checkbox"
                    checked={form.scopes.includes(s)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        scopes: e.target.checked
                          ? API_KEY_SCOPES.filter((x) => x === s || form.scopes.includes(x))
                          : form.scopes.filter((x) => x !== s),
                      })
                    }
                  />
                  {SCOPE_NAME[s]}
                </label>
              ))}
            </div>
            <p id="scope-issues" className="text-xs text-down">
              {create.at("scopes").map((i) => i.message)}
            </p>
          </fieldset>
        </div>
        <p className="mt-2 text-xs text-muted">
          {API_KEY_SCOPES.map((s) => `${SCOPE_NAME[s]}: ${SCOPE_HELP[s]}`).join("; ")}.
        </p>
        <Button type="submit" tone="primary" className="mt-3" disabled={create.busy}>
          Create API key
        </Button>
      </form>

      <ConfirmDialog
        open={revoking !== null}
        title={`Revoke ${revoking?.name ?? "key"}?`}
        confirm="Revoke key"
        busy={busy}
        onClose={() => setRevoking(null)}
        onConfirm={() => {
          const k = revoking;
          setRevoking(null);
          if (k) void revoke(k);
        }}
      >
        Anything using this key is refused from now on. This cannot be undone.
      </ConfirmDialog>

      <Modal open={issued !== null} onClose={close} title="New API key">
        {issued && (
          <div className="flex flex-col gap-3 text-sm">
            <Notice tone="warn">
              This key is shown once. Copy it now: it cannot be shown again. Closing this dialog discards it.
            </Notice>
            <p className="text-muted">
              {issued.name}. Can: {scopeNames(issued.scopes)}.
            </p>
            <CopyField label="API key" value={issued.key} copyLabel="Copy key" />
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        )}
      </Modal>
    </Panel>
  );
}
