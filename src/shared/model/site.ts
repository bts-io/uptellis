import { z } from "zod";
import { Hostname, SiteSlug } from "./common";
import { safeDisplay } from "./safety";

export const Site = z.object({
  slug: SiteSlug,
  name: safeDisplay(80),
  /** Empty for a site served only as the default or only site. */
  hostnames: z.array(Hostname).max(10),
  configVersion: z.number().int().positive(),
});
export type Site = z.infer<typeof Site>;
