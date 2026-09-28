/**
 * The built client files the Docker server answers itself, the same paths Workers Static Assets serves
 * on Cloudflare (`run_worker_first` in wrangler.jsonc excludes exactly these): `/assets/*` (hashed,
 * cached for a year), `/fonts/*` and `/favicon.ico`. Everything else goes to the app.
 */
import { resolve, sep } from "node:path";
import { withSecurityHeaders } from "@/worker/middleware/security-headers";

const STATIC_PATH = /^\/(assets\/|fonts\/|favicon\.ico$)/;

/** The file response for a static path under `clientDir`, or null to hand the request to the app. */
export async function serveStatic(request: Request, clientDir: string): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const { pathname } = new URL(request.url);
  if (!STATIC_PATH.test(pathname)) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const root = resolve(clientDir);
  const path = resolve(root, `.${rel}`);
  if (!path.startsWith(root + sep)) return null;
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  const cache = pathname.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=0, must-revalidate";
  return withSecurityHeaders(new Response(file, { headers: { "cache-control": cache } }), pathname);
}
