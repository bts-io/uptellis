/** The session cookie's name, apart from Better Auth so callers that only look at cookies stay light. */
export const COOKIE_PREFIX = "uptellis";
/** Better Auth's session cookie; `useSecureCookies` adds the `__Secure-` prefix. */
export const SESSION_COOKIE = `__Secure-${COOKIE_PREFIX}.session_token`;
