/**
 * Security headers on every response the Worker sends: pages, the API, gate redirects and 404s, 429s and
 * errors. src/worker/serve.ts applies them last, so they replace whatever an inner layer set (Hono's
 * `secureHeaders` in src/worker/index.ts sets a few of the same names with other values). Files under
 * `/assets/*` and `/fonts/*` are served by Workers Static Assets without running the Worker.
 *
 * The CSP allows inline scripts: TanStack Start streams its hydration data as inline `<script>` tags, and
 * the router only puts a nonce on them when `createRouter({ ssr: { nonce } })` is given one per request.
 * Everything else is limited to this origin. Only `/` may be framed, and only by this origin: the admin
 * theme previews load `/?theme=<id>` in iframes.
 */

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join("; ");

const PERMISSIONS = [
  "accelerometer=()",
  "camera=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "usb=()",
].join(", ");

/** Paths another page of this origin may frame. */
const FRAMEABLE = new Set(["/"]);

/** The headers for a response to `pathname`. */
export function securityHeaders(pathname: string): Record<string, string> {
  const frameable = FRAMEABLE.has(pathname);
  return {
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "permissions-policy": PERMISSIONS,
    "cross-origin-opener-policy": "same-origin",
    "x-frame-options": frameable ? "SAMEORIGIN" : "DENY",
    "content-security-policy": `${CSP}; frame-ancestors ${frameable ? "'self'" : "'none'"}`,
  };
}

/** `res` with the security headers for `pathname` set (a copy: fetched responses have immutable headers). */
export function withSecurityHeaders(res: Response, pathname: string): Response {
  const out = new Response(res.body, res);
  for (const [name, value] of Object.entries(securityHeaders(pathname))) out.headers.set(name, value);
  return out;
}
