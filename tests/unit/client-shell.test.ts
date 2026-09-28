// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandPalette,
  filterItems,
  KeyMap,
  type PaletteItem,
  pageServices,
  paletteItems,
  runAction,
  SHELL_KEYS,
  THEME_KEYS,
  useShellKeys,
} from "@/client/shell";
import { registeredThemes } from "@/client/themes";
import { PERMISSIONS } from "@/shared/auth";
import type { Me } from "@/shared/schemas/auth";
import { buildSiteView } from "@/shared/view";
import { fixtureInput } from "../fixtures/view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const view = buildSiteView(fixtureInput("default"));
const themes = registeredThemes();

const OWNER_EMAIL = ["owner", "example.com"].join("@");
const providers = { emailPassword: true, github: false, google: false } as const;
const OWNER: Me = {
  user: {
    id: "u1",
    name: "Pat Owner",
    email: OWNER_EMAIL,
    image: null,
    role: "owner",
    createdAt: "2026-09-01T00:00:00Z",
  },
  permissions: [...PERMISSIONS],
  providers,
  setupNeeded: false,
};
const VIEWER: Me = { ...OWNER, user: { ...OWNER.user!, role: "viewer" }, permissions: ["page.view"] };
const ANONYMOUS: Me = { user: null, permissions: [], providers, setupNeeded: false };

let root: Root | null = null;
let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});
const mount = (el: ReturnType<typeof createElement>) => {
  root = createRoot(host);
  act(() => root!.render(el));
};

/** Types into an input the way React sees it (value setter, then an input event). */
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const key = (target: EventTarget, init: KeyboardEventInit) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });

describe("palette items", () => {
  it("lists every service to jump to and to copy, in page order", () => {
    const items = paletteItems({ view, themes, siteTheme: undefined, me: null });
    const services = pageServices(view);
    expect(services.length).toBeGreaterThan(0);
    expect(items.filter((i) => i.group === "service").map((i) => i.label)).toEqual(
      services.map((s) => s.name),
    );
    const copy = items.find((i) => i.group === "copy")!;
    expect(copy.action).toEqual({
      kind: "copy",
      serviceId: services[0]!.id,
      name: services[0]!.name,
      text: services[0]!.beatsText,
    });
    expect(items.some((i) => i.group === "admin")).toBe(false);
  });

  it("offers every other registered theme, and the way back during a preview", () => {
    const others = themes.filter((t) => t.module.id !== view.theme).map((t) => t.module.id);
    expect(others.length).toBeGreaterThan(0);
    const plain = paletteItems({ view, themes, siteTheme: undefined, me: null });
    expect(plain.filter((i) => i.group === "theme").map((i) => i.action)).toEqual(
      others.map((theme) => ({ kind: "theme", theme })),
    );
    const previewing = paletteItems({
      view: { ...view, theme: others[0]! },
      themes,
      siteTheme: view.theme,
      me: OWNER,
    });
    const entries = previewing.filter((i) => i.group === "theme");
    expect(entries.map((i) => i.id)).not.toContain(`theme:${others[0]}`);
    expect(entries.find((i) => i.action.kind === "theme" && i.action.theme === null)).toMatchObject({
      label: "Back to sys.status",
      hint: "site theme",
    });
    expect(previewing.find((i) => i.group === "admin")).toMatchObject({ action: { kind: "admin" } });
  });

  it("offers admin by permission, account and sign-out when signed in, sign-in when not", () => {
    const entries = (me: Me | null) =>
      paletteItems({ view, themes, siteTheme: undefined, me })
        .filter((i) => i.group === "admin" || i.group === "account")
        .map((i) => [i.label, i.hint]);
    expect(entries(null)).toEqual([]);
    expect(entries(OWNER)).toEqual([
      ["Open admin", null],
      ["Account", "Pat Owner"],
      ["Sign out", OWNER_EMAIL],
    ]);
    expect(entries(VIEWER)).toEqual([
      ["Account", "Pat Owner"],
      ["Sign out", OWNER_EMAIL],
    ]);
    expect(entries(ANONYMOUS)).toEqual([["Sign in", null]]);
    expect(entries({ ...ANONYMOUS, setupNeeded: true })).toEqual([]);
  });

  it("filters on every word, case-insensitively, across label, hint and group", () => {
    const items = paletteItems({ view, themes, siteTheme: undefined, me: OWNER });
    const name = pageServices(view)[0]!.name;
    const word = name.split(/\s+/)[0]!.toUpperCase();
    expect(filterItems(items, "").length).toBe(items.length);
    const hits = filterItems(items, word);
    expect(hits.length).toBeGreaterThan(0);
    expect(
      hits.every((i) => i.label.toLowerCase().includes(word.toLowerCase()) || i.hint?.includes(word)),
    ).toBe(true);
    expect(filterItems(items, `copy ${word}`).every((i) => i.group === "copy")).toBe(true);
    expect(filterItems(items, "admin").map((i) => i.id)).toContain("admin");
    expect(filterItems(items, "zzzz-nothing")).toEqual([]);
  });
});

describe("command palette", () => {
  const items = paletteItems({ view, themes, siteTheme: undefined, me: OWNER });
  const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];

  it("renders nothing while closed", () => {
    mount(createElement(CommandPalette, { open: false, onClose: () => {}, items, onRun: () => {} }));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it("opens with every entry, filters as you type and runs the chosen one", async () => {
    const onRun = vi.fn<(item: PaletteItem) => void>();
    const onClose = vi.fn();
    mount(createElement(CommandPalette, { open: true, onClose, items, onRun }));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(options()).toHaveLength(items.length);

    const input = document.querySelector<HTMLInputElement>('[role="combobox"]')!;
    const target = pageServices(view)[1]!;
    type(input, target.name);
    expect(options().length).toBeLessThan(items.length);
    expect(options()[0]!.textContent).toContain(target.name);

    // The first match is active as you type; Enter runs it.
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onRun.mock.calls[0]![0].action).toEqual({ kind: "service", serviceId: target.id });
    expect(onClose).toHaveBeenCalled();
  });

  it("says so when nothing matches", () => {
    mount(createElement(CommandPalette, { open: true, onClose: () => {}, items, onRun: () => {} }));
    type(document.querySelector<HTMLInputElement>('[role="combobox"]')!, "zzzz-nothing");
    expect(options()).toHaveLength(0);
    expect(document.body.textContent).toContain("No matches.");
  });
});

describe("shell keys", () => {
  function Probe({ on }: { on: (what: "palette" | "keys") => void }) {
    useShellKeys(on);
    return createElement("input", { "aria-label": "field" });
  }

  it("opens the palette on / and Ctrl or Cmd+K, the map on ?, and leaves theme keys alone", () => {
    const on = vi.fn();
    mount(createElement(Probe, { on }));
    key(document.body, { key: "/" });
    key(document.body, { key: "k", ctrlKey: true });
    key(document.body, { key: "K", metaKey: true });
    key(document.body, { key: "?" });
    for (const k of ["j", "k", "i", "Enter"]) key(document.body, { key: k });
    expect(on.mock.calls.map((c) => c[0])).toEqual(["palette", "palette", "palette", "keys"]);
  });

  it("ignores / and ? while typing in a field", () => {
    const on = vi.fn();
    mount(createElement(Probe, { on }));
    const input = host.querySelector("input")!;
    key(input, { key: "/" });
    key(input, { key: "?" });
    expect(on).not.toHaveBeenCalled();
    key(input, { key: "k", ctrlKey: true });
    expect(on).toHaveBeenCalledWith("palette");
  });

  it("keeps the theme's own keys out of the shell's", () => {
    const shell = new Set(SHELL_KEYS.flatMap((h) => h.keys));
    for (const hints of Object.values(THEME_KEYS))
      for (const k of hints!.flatMap((h) => h.keys)) expect(shell.has(k), k).toBe(false);
  });
});

describe("keyboard map", () => {
  it("lists the shell's keys and the theme's", () => {
    mount(
      createElement(KeyMap, {
        open: true,
        onClose: () => {},
        shell: SHELL_KEYS,
        theme: THEME_KEYS["a-sys-status"]!,
      }),
    );
    const text = document.querySelector('[role="dialog"]')!.textContent;
    for (const label of ["Command palette", "This keyboard map", "Jump to the infra panel"])
      expect(text).toContain(label);
  });
});

describe("palette actions", () => {
  const deps = () => ({
    go: vi.fn<(href: string) => void>(),
    preview: vi.fn<(theme: string | null) => void>(),
    say: vi.fn<(t: string) => void>(),
    reducedMotion: true,
    signOut: vi.fn<() => void>(),
  });

  it("scrolls to and focuses the service's card once the dialog has let go of focus", async () => {
    const s = pageServices(view)[2]!;
    const card = document.createElement("article");
    card.id = `svc-${s.id}`;
    card.tabIndex = 0;
    card.scrollIntoView = vi.fn();
    document.body.append(card);
    runAction({ kind: "service", serviceId: s.id }, deps());
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(card);
    expect(card.scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
  });

  it("copies a service's beat text and says so", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const d = deps();
    const s = pageServices(view)[0]!;
    runAction({ kind: "copy", serviceId: s.id, name: s.name, text: s.beatsText }, d);
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(s.beatsText);
    expect(d.say).toHaveBeenCalledWith(`Copied the beats of ${s.name}`);
    vi.unstubAllGlobals();
  });

  it("switches the theme preview and opens admin", () => {
    const d = deps();
    runAction({ kind: "theme", theme: "c-session" }, d);
    runAction({ kind: "theme", theme: null }, d);
    expect(d.preview.mock.calls).toEqual([["c-session"], [null]]);
    runAction({ kind: "admin" }, d);
    expect(d.go).toHaveBeenCalledWith("/admin");
  });

  it("opens the account page, signs in back to this page, and signs out", () => {
    const d = deps();
    runAction({ kind: "account" }, d);
    runAction({ kind: "signIn" }, d);
    expect(d.go.mock.calls).toEqual([
      ["/account"],
      [`/sign-in?next=${encodeURIComponent(location.pathname)}`],
    ]);
    runAction({ kind: "signOut" }, d);
    expect(d.signOut).toHaveBeenCalledTimes(1);
  });
});
