import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
} from "@headlessui/react";
import { useState } from "react";
import { filterItems, type PaletteItem } from "./items";

const GROUP_LABEL: Record<PaletteItem["group"], string> = {
  service: "jump",
  copy: "copy",
  theme: "theme",
  admin: "admin",
  account: "you",
};

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
  /** Called with the chosen entry; the palette closes itself first. */
  onRun: (item: PaletteItem) => void;
}

/** Headless UI Combobox in a Dialog, styled only with the kit's semantic tokens so it fits every theme. */
export function CommandPalette({ open, onClose, items, onRun }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const shown = filterItems(items, query);
  const close = () => {
    onClose();
    setQuery("");
  };

  return (
    <Dialog open={open} onClose={close} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-base/75" />
      <div className="fixed inset-0 overflow-y-auto px-4 pt-[12vh] pb-4">
        <DialogPanel className="mx-auto max-w-xl border border-line bg-panel font-sans text-ink shadow-2xl">
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <Combobox
            onChange={(item: PaletteItem | null) => {
              if (!item) return;
              close();
              onRun(item);
            }}
          >
            <ComboboxInput
              autoFocus
              aria-label="Search services, themes and actions"
              placeholder="Jump to a service, preview a theme, copy beats, sign in or out"
              className="w-full border-b border-line bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-muted"
              onChange={(e) => setQuery(e.target.value)}
            />
            <ComboboxOptions static className="max-h-[min(60vh,24rem)] overflow-y-auto py-1 empty:hidden">
              {shown.map((item) => (
                <ComboboxOption
                  key={item.id}
                  value={item}
                  className="flex cursor-pointer items-baseline gap-3 px-4 py-2 text-sm data-focus:bg-raised data-focus:text-ink"
                >
                  <span className="w-12 shrink-0 font-mono text-[11px] tracking-[.06em] text-muted uppercase">
                    {GROUP_LABEL[item.group]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.hint && <span className="shrink-0 font-mono text-xs text-muted">{item.hint}</span>}
                </ComboboxOption>
              ))}
            </ComboboxOptions>
            {shown.length === 0 && <p className="px-4 py-3 text-sm text-muted">No matches.</p>}
          </Combobox>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
