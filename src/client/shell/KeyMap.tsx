import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import type { KeyHint } from "./keys";

export interface KeyMapProps {
  open: boolean;
  onClose: () => void;
  shell: KeyHint[];
  theme: KeyHint[];
}

function Rows({ title, hints }: { title: string; hints: KeyHint[] }) {
  if (!hints.length) return null;
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="font-mono text-[11px] tracking-[.06em] text-muted uppercase">{title}</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {hints.map((h) => (
          <div key={h.label + h.keys.join()} className="contents">
            <dt className="flex flex-wrap gap-1">
              {h.keys.map((k) => (
                <kbd key={k} className="border border-line bg-raised px-1.5 font-mono text-xs text-ink">
                  {k}
                </kbd>
              ))}
            </dt>
            <dd className="text-muted">{h.label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The `?` overlay: the shell's keys, then the current theme's. */
export function KeyMap({ open, onClose, shell, theme }: KeyMapProps) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-base/75" />
      <div className="fixed inset-0 overflow-y-auto px-4 pt-[12vh] pb-4">
        <DialogPanel className="mx-auto max-w-md border border-line bg-panel p-5 font-sans text-ink shadow-2xl">
          <DialogTitle className="text-[15px] font-semibold text-ink">Keyboard</DialogTitle>
          <div className="mt-4">
            <Rows title="Everywhere" hints={shell} />
            <Rows title="This theme" hints={theme} />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-5 border border-line px-3 py-1.5 text-sm text-ink hover:bg-raised"
          >
            Close
          </button>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
