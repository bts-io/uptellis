/** The session cookie's name, apart from Better Auth so callers that only look at cookies stay light. */
export const COOKIE_PREFIX = "uptellis";

/**
 * Better Auth's session cookie. Secure (the `__Secure-` prefix and the `Secure` flag) whenever the base URL
 * is https; plain only for an http base URL, which is local development (browsers drop a Secure cookie
 * set over http).
 */
export const sessionCookieName = (secure: boolean) =>
  `${secure ? "__Secure-" : ""}${COOKIE_PREFIX}.session_token`;

/** The session cookie of every https deployment. */
export const SESSION_COOKIE = sessionCookieName(true);
