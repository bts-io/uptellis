/**
 * The site's public reach in the config editor (Phase 6b): `public.enabled` and the `public.fields`
 * allow-list, each with what it unlocks (src/shared/public/summary.ts), and the URLs a site gets: the
 * summary, the site and service badges, the widget and its embed snippet. The badge image reflects the saved
 * settings (the endpoints serve what is saved), so it shows only once the site badge is public.
 */
import { useState } from "react";
import { PUBLIC_FIELDS, type PublicField, type SiteConfig } from "@/shared/config";
import type { ConfigIssue } from "@/shared/schemas/admin";
import { CopyField, IssueText, Notice, SelectField } from "./ui";

type Public = SiteConfig["public"];

/** What each field unlocks, from the contract table. */
export const FIELD_HELP: Record<PublicField, string> = {
  verdict: "The overall state and its label; the site badge.",
  sections: "Sections with each service's state (ids only); service badges by id.",
  serviceNames: "Service names next to those states, and on service badges.",
  uptime90d: "90-day uptime per service; the uptime badge metric.",
  incidentTitles: "Open incidents and the last 5 resolved: titles and times only.",
  generatedAt: "When the summary was built.",
};

const FIELD_LABEL: Record<PublicField, string> = {
  verdict: "Verdict",
  sections: "Sections and service states",
  serviceNames: "Service names",
  uptime90d: "90-day uptime",
  incidentTitles: "Incident titles",
  generatedAt: "Generated at",
};

/** Every public URL of a site, on its first hostname. */
export function publicUrls(origin: string, site: string, service: string) {
  return {
    summary: `${origin}/api/public/${site}/summary.json`,
    siteBadge: `${origin}/badge/${site}.svg`,
    serviceBadge: `${origin}/badge/${site}/${service}.svg`,
    uptimeBadge: `${origin}/badge/${site}/${service}.svg?metric=uptime`,
    widget: `${origin}/embed/${site}`,
    snippet: `<div data-uptellis="${site}"></div><script src="${origin}/embed.js" async></script>`,
  };
}

export function PublicSettings({
  site,
  visibility,
  hostname,
  value,
  saved,
  services,
  issues,
  onChange,
}: {
  site: string;
  visibility: SiteConfig["visibility"];
  /** The site's first hostname: where the public endpoints are served. */
  hostname: string;
  value: Public;
  /** The saved settings, which the endpoints (and the badge preview) serve. */
  saved: Public;
  services: [string, string][];
  issues: ConfigIssue[];
  onChange: (value: Public) => void;
}) {
  const [service, setService] = useState(services[0]?.[0] ?? "");
  const urls = publicUrls(`https://${hostname}`, site, service || "<service>");
  const badgeLive = saved.enabled && saved.fields.includes("verdict");
  const toggle = (field: PublicField, on: boolean) =>
    onChange({
      ...value,
      fields: on
        ? PUBLIC_FIELDS.filter((f) => f === field || value.fields.includes(f))
        : value.fields.filter((f) => f !== field),
    });

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">Public summary, badges and widget</legend>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        <span>
          Public access
          <span className="block text-xs text-muted">
            Serves the summary, badges and widget below to anyone, with only the checked fields. Off, they
            answer 404 as for an unknown site.
          </span>
        </span>
      </label>
      {visibility === "private" && (
        <Notice tone="warn" className="mt-3">
          This site's page is private, so its public endpoints (summary, badges, widget) always answer 404,
          whatever this switch says. Make the page public under Visibility to publish them.
        </Notice>
      )}
      {value.enabled && value.fields.length === 0 && (
        <Notice tone="warn" className="mt-3">
          No field is checked: the summary carries only the site name, and every badge is 404.
        </Notice>
      )}

      <ul className="mt-3 flex flex-col gap-2">
        {PUBLIC_FIELDS.map((f) => (
          <li key={f}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={value.fields.includes(f)}
                onChange={(e) => toggle(f, e.target.checked)}
              />
              <span>
                {FIELD_LABEL[f]} <span className="font-mono text-xs text-faint">{f}</span>
                <span className="block text-xs text-muted">{FIELD_HELP[f]}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <IssueText issues={issues} />

      <div className="mt-4 flex flex-col gap-3" aria-label="Public URLs" role="group">
        <p className="text-xs text-muted">
          Served on <span className="font-mono">{hostname}</span> from the saved settings.
        </p>
        <dl className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-[9rem_1fr]">
          <dt className="text-muted">Summary</dt>
          <dd className="break-all font-mono">{urls.summary}</dd>
          <dt className="text-muted">Site badge</dt>
          <dd className="break-all font-mono">{urls.siteBadge}</dd>
          <dt className="text-muted">Service badge</dt>
          <dd className="break-all font-mono">{urls.serviceBadge}</dd>
          <dt className="text-muted">Uptime badge</dt>
          <dd className="break-all font-mono">{urls.uptimeBadge}</dd>
          <dt className="text-muted">Widget</dt>
          <dd className="break-all font-mono">{urls.widget}</dd>
        </dl>
        {services.length > 0 && (
          <SelectField
            label="Service for the badge URLs"
            value={service}
            className="max-w-sm"
            onChange={(e) => setService(e.target.value)}
          >
            {services.map(([id, name]) => (
              <option key={id} value={id}>
                {name} ({id})
              </option>
            ))}
          </SelectField>
        )}
        <CopyField label="Embed snippet" value={urls.snippet} copyLabel="Copy snippet" />
        <div>
          <p className="text-xs text-muted">Site badge</p>
          {badgeLive ? (
            <img src={`/badge/${site}.svg`} alt={`Status badge of ${site}`} className="mt-1 h-5" />
          ) : (
            <p className="mt-1 text-xs text-muted">
              Shown here once public access with the verdict field is saved.
            </p>
          )}
        </div>
      </div>
    </fieldset>
  );
}
