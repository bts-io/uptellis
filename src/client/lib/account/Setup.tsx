import { useState } from "react";
import { z } from "zod";
import { VISIBILITIES, type Visibility } from "@/shared/auth";
import { ThemeId } from "@/shared/config";
import { Hostname, SiteSlug } from "@/shared/model";
import { monitorsOf } from "@/shared/monitors";
import type { ConfigState } from "@/shared/schemas/admin";
import { SetupRequest } from "@/shared/schemas/auth";
import { registeredThemes } from "../../themes";
import { createSite, getConfig, saveConfig } from "../admin/client";
import { Button, Field, Notice, SelectField } from "../admin/ui";
import { setupOwner } from "./client";
import { useSubmit } from "./form";

/** The first-run screen of admin ("What should we watch?"), where a site that watches nothing yet starts. */
const WELCOME_PATH = "/admin/welcome";

const OwnerForm = SetupRequest.extend({ confirm: z.string() }).refine((f) => f.password === f.confirm, {
  message: "The passwords do not match",
  path: ["confirm"],
});

const SiteForm = z.object({
  slug: SiteSlug,
  name: z.string().trim().min(1).max(80),
  hostname: Hostname,
  visibility: z.enum(VISIBILITIES),
  theme: ThemeId,
});
type SiteForm = z.infer<typeof SiteForm>;

/** A minimal config for a new site: no sources or sections yet, those come from admin. */
const newSiteConfig = (f: SiteForm) => ({
  v: 1,
  slug: f.slug,
  name: f.name,
  hostnames: [f.hostname],
  theme: f.theme,
  visibility: f.visibility,
  sources: [],
  sections: [],
  branding: { title: f.name },
});

/**
 * First-run setup, shown only while the instance has no account: 1. the owner account (signed in on
 * success), 2. the first site, either the one this host already serves (confirm or adjust it) or a new one,
 * 3. into admin: the first-run screen when the site watches nothing yet, else the dashboard. `site` is the
 * slug this host resolves to, `host` the hostname the browser used.
 */
export function Setup({ site, host }: { site: string | null; host: string }) {
  const [step, setStep] = useState<"owner" | "site">("owner");
  const [existing, setExisting] = useState<ConfigState | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex gap-4 text-xs text-muted" aria-label="Setup steps">
        <li aria-current={step === "owner" ? "step" : undefined} className="aria-[current=step]:text-ink">
          1. Owner account
        </li>
        <li aria-current={step === "site" ? "step" : undefined} className="aria-[current=step]:text-ink">
          2. First site
        </li>
      </ol>
      {step === "owner" ? (
        <OwnerStep
          onDone={async () => {
            setExisting(site ? await getConfig(site).catch(() => null) : null);
            setStep("site");
          }}
        />
      ) : (
        <SiteStep existing={existing} host={host} />
      )}
    </div>
  );
}

function OwnerStep({ onDone }: { onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirm: "" });
  const { busy, failure, submit, at } = useSubmit(OwnerForm, async ({ confirm: _, ...owner }) => {
    await setupOwner(owner);
    await onDone();
  });
  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(form);
      }}
    >
      <p className="text-sm text-muted">
        The owner can do everything, including inviting others. Only this first account is created here.
      </p>
      {failure && <Notice tone="error">{failure.message}</Notice>}
      <Field
        label="Name"
        autoComplete="name"
        value={form.name}
        issues={at("name")}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <Field
        label="Email"
        type="email"
        autoComplete="username"
        value={form.email}
        issues={at("email")}
        onChange={(e) => setForm({ ...form, email: e.target.value })}
      />
      <Field
        label="Password (at least 12 characters)"
        type="password"
        autoComplete="new-password"
        value={form.password}
        issues={at("password")}
        onChange={(e) => setForm({ ...form, password: e.target.value })}
      />
      <Field
        label="Confirm password"
        type="password"
        autoComplete="new-password"
        value={form.confirm}
        issues={at("confirm")}
        onChange={(e) => setForm({ ...form, confirm: e.target.value })}
      />
      <Button type="submit" tone="primary" disabled={busy} className="mt-1">
        Create owner account
      </Button>
    </form>
  );
}

function SiteStep({ existing, host }: { existing: ConfigState | null; host: string }) {
  const [creating, setCreating] = useState(existing === null);
  const fresh: SiteForm = {
    slug: "",
    name: "",
    hostname: Hostname.safeParse(host).success ? host : "",
    visibility: "private",
    theme: "a-sys-status",
  };
  const confirmed: SiteForm | null = existing && {
    slug: existing.config.slug,
    name: existing.config.name,
    hostname: existing.config.hostnames[0] ?? fresh.hostname,
    visibility: existing.config.visibility,
    theme: existing.config.theme,
  };
  const [form, setForm] = useState<SiteForm>(confirmed ?? fresh);
  const { busy, failure, submit, at, clear } = useSubmit(SiteForm, async (f) => {
    if (creating || !existing) {
      await createSite(newSiteConfig(f));
      window.location.assign(WELCOME_PATH);
      return;
    }
    const { config } = existing;
    const hostnames = config.hostnames.includes(f.hostname)
      ? config.hostnames
      : [f.hostname, ...config.hostnames.slice(1)];
    const next = { ...config, name: f.name, hostnames, visibility: f.visibility, theme: f.theme };
    await saveConfig(config.slug, next, existing.version, "first-run setup");
    // A site that already watches something opens on its dashboard; an empty one asks what to watch.
    const watches = monitorsOf(config).length > 0 || config.sources.length > 0;
    window.location.assign(watches ? "/admin" : WELCOME_PATH);
  });
  const switchTo = (create: boolean) => {
    setCreating(create);
    setForm(create || !confirmed ? fresh : confirmed);
    clear();
  };
  const themes = registeredThemes();

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(form);
      }}
    >
      <Notice tone="ok">Owner account created; you are signed in.</Notice>
      <p className="text-sm text-muted">
        {creating
          ? "Create the first site. Sources, sections and the rest are set up in admin."
          : `This address serves the site ${existing?.config.slug}. Confirm or adjust it.`}
      </p>
      {failure && <Notice tone="error">{failure.message}</Notice>}
      <Field
        label="Slug"
        value={form.slug}
        readOnly={!creating}
        issues={at("slug")}
        placeholder="acme"
        onChange={(e) => setForm({ ...form, slug: e.target.value })}
      />
      <Field
        label="Name"
        value={form.name}
        issues={at("name")}
        placeholder="Acme Cloud"
        onChange={(e) => setForm({ ...form, name: e.target.value })}
      />
      <Field
        label="Hostname"
        value={form.hostname}
        issues={at("hostname")}
        placeholder="status.example.com"
        onChange={(e) => setForm({ ...form, hostname: e.target.value })}
      />
      <SelectField
        label="Visibility"
        value={form.visibility}
        onChange={(e) => setForm({ ...form, visibility: e.target.value as Visibility })}
      >
        {VISIBILITIES.map((v) => (
          <option key={v} value={v}>
            {v === "public" ? "public (anyone can see the page)" : "private (signed-in users only)"}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Theme"
        value={form.theme}
        onChange={(e) => setForm({ ...form, theme: e.target.value as ThemeId })}
      >
        {themes.map((t) => (
          <option key={t.module.id} value={t.module.id}>
            {t.module.label}
          </option>
        ))}
      </SelectField>
      <div className="mt-1 flex flex-wrap gap-2">
        <Button type="submit" tone="primary" disabled={busy}>
          {creating ? "Create site and open admin" : "Save and open admin"}
        </Button>
        {existing && (
          <Button onClick={() => switchTo(!creating)} disabled={busy}>
            {creating ? `Use ${existing.config.slug} instead` : "Create a new site instead"}
          </Button>
        )}
      </div>
    </form>
  );
}
