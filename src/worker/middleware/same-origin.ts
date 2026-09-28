/**
 * CSRF check for writes: a mutating request to the admin API, setup or an invite must come from this
 * origin. Browsers send `Sec-Fetch-Site`; without it, an `Origin` equal to the request's own is required.
 */

/** True when a browser says the request comes from this origin. */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) return site === "same-origin";
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}
