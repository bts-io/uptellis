// @vitest-environment happy-dom
import { act, createElement, type FunctionComponent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as effects from "../../../src/client/effects";
import type { Effects } from "../../../src/client/kit/props";

// The module must satisfy the frozen hook signatures.
const typed: Effects = effects;
const {
  useAgeTicker,
  useDecrypt,
  useMatrixRain,
  useReducedMotion,
  useSessionOnce,
  useStateChangeGlow,
  useVisibilityPause,
} = typed;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let reduced = false;
const roots: Root[] = [];

/** Mounts a component that runs `hook` with `props`; `value()` is its latest result. */
function mount<P extends object, T>(hook: (p: P) => T, props: P) {
  let latest: T | undefined;
  const Probe: FunctionComponent<P> = (p) => {
    latest = hook(p);
    return null;
  };
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  act(() => root.render(createElement(Probe, props)));
  return {
    value: () => latest as T,
    rerender: (next: P) => act(() => root.render(createElement(Probe, next))),
  };
}

beforeEach(() => {
  reduced = false;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("reduce") && reduced,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  sessionStorage.clear();
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"],
  });
});

afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("on the server", () => {
  it("every hook returns its static value", () => {
    let out: unknown[] = [];
    const Probe = () => {
      out = [
        useReducedMotion(),
        useVisibilityPause(),
        useSessionOnce("server"),
        useDecrypt("OPS"),
        useAgeTicker("2026-09-27T23:58:00Z", "2026-09-27T23:58:34Z"),
        useStateChangeGlow("up"),
      ];
      return null;
    };
    renderToString(createElement(Probe));
    expect(out).toEqual([false, true, false, "OPS", 34, false]);
  });
});

describe("in the browser", () => {
  it("reads the reduced-motion preference", () => {
    reduced = true;
    expect(mount(useReducedMotion, {}).value()).toBe(true);
  });

  it("reports a hidden tab", () => {
    const vis = mount(useVisibilityPause, {});
    expect(vis.value()).toBe(true);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(vis.value()).toBe(false);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
  });

  it("is true once per session per key", () => {
    expect(mount(({ k }: { k: string }) => useSessionOnce(k), { k: "intro" }).value()).toBe(true);
    expect(mount(({ k }: { k: string }) => useSessionOnce(k), { k: "intro" }).value()).toBe(false);
    expect(mount(({ k }: { k: string }) => useSessionOnce(k), { k: "other" }).value()).toBe(true);
    expect(sessionStorage.getItem("uptellis-once:intro")).toBe("1");
  });

  it("ticks the age forward from the server's value", () => {
    const age = mount(({ s, n }: { s: string; n: string }) => useAgeTicker(s, n), {
      s: "2026-09-27T23:58:00Z",
      n: "2026-09-27T23:58:34Z",
    });
    expect(age.value()).toBe(34);
    act(() => vi.advanceTimersByTime(3000));
    expect(age.value()).toBe(37);
    // New data restarts from the new server value.
    age.rerender({ s: "2026-09-27T23:59:00Z", n: "2026-09-27T23:59:05Z" });
    expect(age.value()).toBe(5);
  });

  it("decrypts once per session and then shows the text", () => {
    const text = "DECRYPT ME";
    const d = mount(({ t }: { t: string }) => useDecrypt(t, { durationMs: 1200 }), { t: text });
    expect(d.value()).not.toBe(text);
    expect(d.value()).toHaveLength(text.length);
    act(() => vi.advanceTimersByTime(1300));
    expect(d.value()).toBe(text);
    const again = mount(({ t }: { t: string }) => useDecrypt(t), { t: text });
    expect(again.value()).toBe(text);
  });

  it("never decrypts under reduced motion or when disabled", () => {
    reduced = true;
    expect(mount(({ t }: { t: string }) => useDecrypt(t), { t: "REDUCED" }).value()).toBe("REDUCED");
    reduced = false;
    expect(mount(({ t }: { t: string }) => useDecrypt(t, { enabled: false }), { t: "OFF" }).value()).toBe(
      "OFF",
    );
    // Neither run used up the session's one decrypt.
    expect(sessionStorage.getItem("uptellis-once:decrypt:REDUCED")).toBeNull();
    expect(sessionStorage.getItem("uptellis-once:decrypt:OFF")).toBeNull();
  });

  it("glows for `ms` after the value changes, not on mount", () => {
    const g = mount(({ v }: { v: string }) => useStateChangeGlow(v, 800), { v: "up" });
    expect(g.value()).toBe(false);
    g.rerender({ v: "down" });
    expect(g.value()).toBe(true);
    act(() => vi.advanceTimersByTime(800));
    expect(g.value()).toBe(false);
  });

  it("draws no rain under reduced motion or when disabled", () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const canvas = { current: document.createElement("canvas") };
    reduced = true;
    mount(() => useMatrixRain(canvas), {});
    reduced = false;
    mount(() => useMatrixRain(canvas, { enabled: false }), {});
    expect(getContext).not.toHaveBeenCalled();
    mount(() => useMatrixRain(canvas, { fps: 12 }), {});
    expect(getContext).toHaveBeenCalledWith("2d");
    getContext.mockRestore();
  });
});
