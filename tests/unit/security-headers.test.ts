import { describe, expect, it } from "vitest";
import { securityHeaders, withSecurityHeaders } from "@/worker/middleware/security-headers";

/** The CSP as directive name -> value. */
const csp = (pathname: string) =>
  Object.fromEntries(
    securityHeaders(pathname)
      ["content-security-policy"]!.split("; ")
      .map((d) => [d.split(" ")[0]!, d.slice(d.indexOf(" ") + 1)]),
  );

describe("security headers", () => {
  it("set HSTS, nosniff, no referrer, COOP and a minimal permissions policy", () => {
    const h = securityHeaders("/api/sites/demo/view");
    expect(h["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin");
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      expect(h["permissions-policy"]).toContain(`${feature}=()`);
    }
  });

  it("lock the CSP to this origin, with inline scripts and styles for SSR hydration", () => {
    expect(csp("/admin")).toEqual({
      "default-src": "'self'",
      "script-src": "'self' 'unsafe-inline'",
      "style-src": "'self' 'unsafe-inline'",
      "img-src": "'self' data:",
      "font-src": "'self'",
      "connect-src": "'self'",
      "object-src": "'none'",
      "base-uri": "'none'",
      "form-action": "'self'",
      "frame-ancestors": "'none'",
    });
  });

  it("let only / be framed, and only by this origin (the admin theme previews)", () => {
    expect(securityHeaders("/")["x-frame-options"]).toBe("SAMEORIGIN");
    expect(csp("/")["frame-ancestors"]).toBe("'self'");
    for (const p of ["/admin", "/api/health", "/_preview", "/x/"]) {
      expect(securityHeaders(p)["x-frame-options"], p).toBe("DENY");
      expect(csp(p)["frame-ancestors"], p).toBe("'none'");
    }
  });

  it("replace what an inner layer set and keep status, body and other headers", async () => {
    const inner = Response.redirect("https://status.example/", 302);
    const out = withSecurityHeaders(inner, "/admin");
    expect(out.status).toBe(302);
    expect(out.headers.get("location")).toBe("https://status.example/");
    expect(out.headers.get("x-frame-options")).toBe("DENY");

    const json = new Response('{"ok":true}', {
      status: 201,
      headers: { "content-type": "application/json", "x-frame-options": "SAMEORIGIN" },
    });
    const copy = withSecurityHeaders(json, "/api/x");
    expect(copy.status).toBe(201);
    expect(copy.headers.get("content-type")).toBe("application/json");
    expect(copy.headers.get("x-frame-options")).toBe("DENY");
    expect(await copy.json()).toEqual({ ok: true });
  });
});
