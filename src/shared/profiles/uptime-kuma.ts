import { isNewer } from "../view/version";
import { own, str } from "./read";
import type { Profile } from "./types";

/** What the Kuma collector reports about the Uptime Kuma instance it reads (group `kuma`). */
export const uptimeKuma: Profile = {
  id: "uptime-kuma",
  name: "Uptime Kuma",
  description: "The Uptime Kuma instance the collector reads: version, database size, host and timezone.",
  groups: [
    {
      id: "kuma",
      title: "Uptime Kuma",
      icon: "eye",
      order: 80,
      keys: [
        {
          key: "reachable",
          label: "Reachable",
          format: "bool",
          level: (f) => (own.bool(f) === null ? null : own.bool(f) ? "ok" : "crit"),
        },
        { key: "version", label: "Version", format: "text" },
        { key: "latestVersion", label: "Latest version", format: "text" },
        { key: "host", label: "Host", format: "text" },
        { key: "timezone", label: "Timezone", format: "text" },
        { key: "dbSize", label: "Database size", format: "number" },
      ],
      summary: (ctx) => {
        const version = str(ctx, "kuma.version");
        const host = str(ctx, "kuma.host");
        return [version, host && `on ${host}`].filter(Boolean).join(" ") || null;
      },
    },
  ],
  highlights: [
    {
      fact: "kuma.version",
      label: "kuma",
      // Kuma reports the latest release, which can be older than a pre-release in use: never offer a downgrade.
      note: (ctx) => {
        const version = str(ctx, "kuma.version");
        const latest = str(ctx, "kuma.latestVersion");
        if (version === null || latest === null) return null;
        return isNewer(latest, version)
          ? { text: `${latest} available`, level: "warn" }
          : { text: "latest", level: "ok" };
      },
    },
    { fact: "kuma.dbSize", label: "kuma" },
    { fact: "kuma.host", label: "collector" },
    { fact: "kuma.timezone", label: "collector" },
  ],
  producerGuide: "collector/README.md",
};
