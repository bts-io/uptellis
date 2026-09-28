// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicSummary } from "@/shared/public/summary";
import { EMBED_SCRIPT, REFRESH_MS, renderWidgetHtml, WIDGET_CSS } from "@/worker/public/widget";

const HOSTILE = `<img src=x onerror="alert(1)">&amp;`;

const summary: PublicSummary = {
  v: 1,
  site: { slug: "demo", name: `Acme ${HOSTILE}` },
  verdict: { state: "outage", label: "1 service down" },
  sections: [
    {
      id: "web",
      title: "Web",
      services: [
        { id: "kuma:1", state: "down", name: HOSTILE, uptime90d: 0.999 },
        { id: "kuma:2", state: "up", uptime90d: null },
      ],
    },
  ],
};

describe("widget page", () => {
  it("escapes every text and shows only the summary's parts", () => {
    const html = renderWidgetHtml(summary, "https://status.example.com/");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;amp;");
    expect(html).toContain("1 service down");
    expect(html).toContain("uw-s-down");
    expect(html).toContain("99.9%");
    expect(html).toContain('href="https://status.example.com/"');

    const bare = renderWidgetHtml({ v: 1, site: { slug: "demo", name: "Acme" } }, null).split("<body>")[1]!;
    expect(bare).toContain("Acme");
    expect(bare).not.toContain("uw-svc");
    expect(bare).not.toContain("uw-verdict");
    expect(bare).not.toContain("<a ");
  });

  it("is self-contained: inline CSS, no script, no external resource", () => {
    const html = renderWidgetHtml({ ...summary, site: { slug: "demo", name: "Acme" } }, null).replaceAll(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;amp;",
      "",
    );
    expect(html).not.toMatch(/<script|<link|<img|src=|url\(|@import/i);
    expect(html).not.toMatch(/https?:/);
    expect(html).toContain("prefers-color-scheme:dark");
    expect(WIDGET_CSS).not.toMatch(/url\(|@import/);
  });
});

describe("embed.js", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let htmlWrites = 0;
  const restore: (() => void)[] = [];

  /** Counts (and blocks) any HTML parsing entry point on elements. */
  const trapHtml = () => {
    for (const proto of [Element.prototype, HTMLElement.prototype]) {
      for (const name of ["innerHTML", "outerHTML"] as const) {
        const desc = Object.getOwnPropertyDescriptor(proto, name);
        if (!desc) continue;
        Object.defineProperty(proto, name, {
          ...desc,
          set() {
            htmlWrites++;
          },
        });
        restore.push(() => Object.defineProperty(proto, name, desc));
      }
    }
    const adjacent = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = () => {
      htmlWrites++;
    };
    restore.push(() => {
      Element.prototype.insertAdjacentHTML = adjacent;
    });
  };

  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  };

  const run = () => new Function(EMBED_SCRIPT)();

  beforeEach(() => {
    vi.useFakeTimers();
    htmlWrites = 0;
    trapHtml();
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => summary }));
    vi.stubGlobal("fetch", fetchMock);
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    for (const r of restore.splice(0)) r();
    Reflect.deleteProperty(document, "currentScript");
  });

  it("uses no HTML parsing API in its source", () => {
    expect(EMBED_SCRIPT).not.toMatch(
      /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/,
    );
    expect(EMBED_SCRIPT).toContain("textContent");
    // The trap works: a write through innerHTML is counted and parses nothing.
    const probe = document.createElement("div");
    probe.innerHTML = "<b>x</b>";
    expect(htmlWrites).toBe(1);
    expect(probe.querySelector("b")).toBeNull();
  });

  it("draws the widget from summary.json with DOM calls, text as text", async () => {
    const host = document.createElement("div");
    host.setAttribute("data-uptellis", "demo");
    host.setAttribute("data-uptellis-base", "https://status.example.org");
    document.body.append(host);
    run();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://status.example.org/api/public/demo/summary.json");
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ credentials: "omit" });

    const root = document.querySelector("div[data-uptellis]")!;
    expect(root.getAttribute("data-uptellis-state")).toBe("ok");
    expect(root.querySelector(".uw-name")!.textContent).toBe(`Acme ${HOSTILE}`);
    expect(root.querySelector(".uw-verdict")!.className).toContain("uw-s-down");
    const services = [...root.querySelectorAll(".uw-svc")];
    expect(services).toHaveLength(2);
    expect(services[0]!.querySelector(".uw-label")!.textContent).toBe(HOSTILE);
    expect(services[0]!.querySelector(".uw-meta")!.textContent).toBe("Down · 99.9%");
    expect(services[1]!.querySelector(".uw-label")!.textContent).toBe("kuma:2");
    expect(services[1]!.querySelector(".uw-meta")!.textContent).toBe("Up · no data");
    expect(root.querySelector("img")).toBeNull();
    expect(document.getElementById("uptellis-widget-css")!.textContent).toBe(WIDGET_CSS);
    expect(htmlWrites).toBe(0);
  });

  it("defaults the base to its own origin and refreshes every minute", async () => {
    Object.defineProperty(document, "currentScript", {
      configurable: true,
      value: { src: "https://status.example.com/embed.js" },
    });
    const root = document.createElement("div");
    root.setAttribute("data-uptellis", "demo");
    document.body.append(root);
    run();
    await flush();
    expect(fetchMock.mock.calls[0]![0]).toBe("https://status.example.com/api/public/demo/summary.json");

    await vi.advanceTimersByTimeAsync(REFRESH_MS);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(root.querySelectorAll(".uptellis-w")).toHaveLength(1);
    expect(htmlWrites).toBe(0);
  });

  it("refuses a bad slug or base and shows unavailable on a 404", async () => {
    const bad = document.createElement("div");
    bad.setAttribute("data-uptellis", "../admin");
    bad.setAttribute("data-uptellis-base", "https://status.example.org");
    const js = document.createElement("div");
    js.setAttribute("data-uptellis", "demo");
    js.setAttribute("data-uptellis-base", "javascript:alert(1)");
    document.body.append(bad, js);
    run();
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(bad.textContent).toBe("Status unavailable");
    expect(js.textContent).toBe("Status unavailable");

    document.body.replaceChildren();
    fetchMock.mockImplementation(async () => ({ ok: false, json: async () => ({}) }));
    const missing = document.createElement("div");
    missing.setAttribute("data-uptellis", "nope");
    missing.setAttribute("data-uptellis-base", "https://status.example.org");
    document.body.append(missing);
    run();
    await flush();
    expect(missing.textContent).toBe("Status unavailable");
    expect(htmlWrites).toBe(0);
  });
});
