import { z } from "zod";
import { Hostname, SiteSlug } from "./common";
import { safeDisplay } from "./safety";

export const Site = z.object({
  slug: SiteSlug,
  name: safeDisplay(80),
  hostnames: z.array(Hostname).min(1).max(10),
  configVersion: z.number().int().positive(),
});
export type Site = z.infer<typeof Site>;
