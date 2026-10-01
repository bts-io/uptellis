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
import { AdminIcon } from "../admin/icons";
import { Button, Field, Notice, SelectField } from "../admin/ui";
import { setupOwner } from "./client";
import { useSubmit } from "./form";

/** The first-run screen of admin ("What should we watch?"), where a site that watches nothing yet starts. */
const WELCOME_PATH = "/admin/welcome";

const OwnerForm = SetupRequest.extend({ confirm: z.string() }).refine((f) => f.password === f.confirm, {
  message: "The passwords do not match",
  path: ["confirm"],
});

/** The bundled demo site's slug: offered in setup only as "Use the demo instead", never the default. */
export const DEMO_SLUG = "demo";

const SiteForm = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80),
  slug: z.string().regex(/^[a-z0-9-]{2,32}$/, "Use 2 to 32 lower-case letters, digits or dashes"),
  // Optional: empty serves the site as the instance's default or only site (local use, `localhost`).
  hostname: z
    .string()
    .trim()
    .refine((h) => h === "" || Hostname.safeParse(h).success, {
      message: "Enter a domain like status.example.com, or leave it empty",
    }),
  visibility: z.enum(VISIBILITIES),
  theme: ThemeId,
});
type SiteForm = z.infer<typeof SiteForm>;

/** A slug from a site name: `Acme Cloud` -> `acme-cloud`; `site` when the name has nothing to use. */
export function slugFromName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 32)
    .replace(/^-+|-+$/g, "");
  return SiteSlug.safeParse(slug).success ? slug : "site";
}

/** A minimal config for a new site: no sources or sections yet, those come from admin. */
export const newSiteConfig = (f: SiteForm) => ({
  v: 1,
  slug: f.slug,
  name: f.name,
  hostnames: f.hostname ? [f.hostname] : [],
  theme: f.theme,
  visibility: f.visibility,
  sources: [],
  sections: [],
  branding: { title: f.name },
});

/**
 * First-run setup, shown while the instance has no account (or, from `start: "site"`, no site): 1. the
 * owner account (signed in on success), 2. the first site: a new one by name (the default), or the one this
 * host already serves to confirm or adjust (the bundled demo only on request), 3. into admin: the first-run
 * screen when the site watches nothing yet, else the dashboard. `site` is the slug this host resolves to,
 * `host` the hostname the browser used.
 */
export function Setup({
  site,
  host,
  start = "owner",
}: {
  site: string | null;
  host: string;
  start?: "owner" | "site";
}) {
  const [step, setStep] = useState<"owner" | "site">(start);
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
        <SiteStep existing={existing} host={host} signedIn={start === "owner"} />
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

function SiteStep({
  existing,
  host,
  signedIn,
}: {
  existing: ConfigState | null;
  host: string;
  signedIn: boolean;
}) {
  // The demo is never the default: with it (or nothing) behind this address, the user's own site is.
  const demo = existing?.config.slug === DEMO_SLUG;
  const [creating, setCreating] = useState(existing === null || demo);
  const [slugEdited, setSlugEdited] = useState(false);
  // A new site takes over this address when another site serves it only as the default (the staging demo);
  // `localhost` and addresses are no domain, and need none: the only site is served anyway.
  const takeOver =
    existing !== null && Hostname.safeParse(host).success && !existing.config.hostnames.includes(host);
  const fresh: SiteForm = {
    slug: "",
    name: "",
    hostname: takeOver ? host : "",
    visibility: "private",
    theme: "a-sys-status",
  };
  const confirmed: SiteForm | null = existing && {
    slug: existing.config.slug,
    name: existing.config.name,
    hostname: existing.config.hostnames[0] ?? "",
    visibility: existing.config.visibility,
    theme: existing.config.theme,
  };
  const [form, setForm] = useState<SiteForm>(creating || !confirmed ? fresh : confirmed);
  const { busy, failure, submit, at, clear } = useSubmit(SiteForm, async (f) => {
    if (creating || !existing) {
      await createSite(newSiteConfig(f));
      window.location.assign(WELCOME_PATH);
      return;
    }
    const { config } = existing;
    const hostnames =
      !f.hostname || config.hostnames.includes(f.hostname)
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
    setSlugEdited(false);
    setForm(create || !confirmed ? fresh : confirmed);
    clear();
  };
  const themes = registeredThemes();
  const moreIssues = at("slug").length + at("hostname").length > 0;
  const other = existing ? (demo ? "Use the demo instead" : `Use ${existing.config.slug} instead`) : null;

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(form);
      }}
    >
      {signedIn && <Notice tone="ok">Owner account created; you are signed in.</Notice>}
      <p className="text-sm text-muted">
        {creating
          ? "Name your status page. Monitors, alerts and the rest are set up in admin."
          : `This address serves the site ${existing?.config.name}. Confirm or adjust it.`}
      </p>
      {failure && <Notice tone="error">{failure.message}</Notice>}
      <Field
        label="Name"
        value={form.name}
        issues={at("name")}
        placeholder="Acme Cloud"
        onChange={(e) =>
          setForm({
            ...form,
            name: e.target.value,
            ...(creating && !slugEdited
              ? { slug: e.target.value.trim() ? slugFromName(e.target.value) : "" }
              : {}),
          })
        }
      />
      <details className="group border border-line" open={moreIssues || undefined}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5">
          <span className="min-w-0">
            <span className="block text-sm font-medium text-ink">More</span>
            <span className="block truncate text-xs text-muted">
              Address, own domain, visibility and theme; all can change later
            </span>
          </span>
          <AdminIcon name="chevron" className="text-muted group-open:rotate-180" />
        </summary>
        <div className="flex flex-col gap-3 border-t border-line p-3">
          <div>
            <Field
              label="Slug"
              value={form.slug}
              readOnly={!creating}
              issues={at("slug")}
              placeholder="acme-cloud"
              onChange={(e) => {
                setSlugEdited(true);
                setForm({ ...form, slug: e.target.value });
              }}
            />
            <p className="mt-1 text-xs text-muted">The site's short id in links and files, from its name.</p>
          </div>
          <div>
            <Field
              label="Own domain (optional)"
              value={form.hostname}
              issues={at("hostname")}
              placeholder="status.example.com"
              onChange={(e) => setForm({ ...form, hostname: e.target.value })}
            />
            <p className="mt-1 text-xs text-muted">
              Only needed to serve this site on its own domain. Leave it empty to try it locally: an
              instance's only site is served on any address.
            </p>
          </div>
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
        </div>
      </details>
      <div className="mt-1 flex flex-wrap gap-2">
        <Button type="submit" tone="primary" disabled={busy}>
          {creating ? "Create site and open admin" : "Save and open admin"}
        </Button>
        {existing && (
          <Button onClick={() => switchTo(!creating)} disabled={busy}>
            {creating ? other : "Create a new site instead"}
          </Button>
        )}
      </div>
    </form>
  );
}
