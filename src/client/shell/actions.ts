import type { ThemeId } from "@/shared/config";
import { type PaletteAction, serviceAnchor } from "./items";

export interface ActionDeps {
  /** Client-side navigation to a same-origin href. */
  go: (href: string) => void;
  /** Shows `theme` as a `?theme=` preview on this page, or leaves the preview for null. */
  preview: (theme: ThemeId | null) => void;
  /** Announces a short result (copied, failed). */
  say: (text: string) => void;
  reducedMotion: boolean;
}

/** Runs a palette entry's action. The palette has closed by then (see `CommandPalette.onRun`). */
export function runAction(action: PaletteAction, { go, preview, say, reducedMotion }: ActionDeps): void {
  switch (action.kind) {
    case "service":
      // After the dialog has handed focus back to where it was, so the card keeps it.
      setTimeout(() => {
        const card = document.getElementById(serviceAnchor(action.serviceId));
        card?.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
        card?.focus({ preventScroll: true });
      }, 0);
      return;
    case "copy":
      if (!navigator.clipboard) say("Copy is not available here");
      else
        navigator.clipboard.writeText(action.text).then(
          () => say(`Copied the beats of ${action.name}`),
          () => say("Copy failed"),
        );
      return;
    case "theme":
      preview(action.theme);
      return;
    case "admin":
      go("/admin");
  }
}
