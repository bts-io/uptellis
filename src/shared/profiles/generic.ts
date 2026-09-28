import type { Profile } from "./types";

/**
 * Always active and first: declares nothing, so every group and key no other profile knows renders with a
 * humanised label and a format inferred from the value's type and unit (see `src/shared/view/facts.ts`).
 */
export const generic: Profile = {
  id: "generic",
  name: "Generic",
  description:
    "Renders any fact group and key plainly: humanised labels, formats from the value's type and unit.",
  groups: [],
};
