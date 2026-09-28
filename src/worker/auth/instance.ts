/**
 * Better Auth for one request: accounts, sessions and JWTs over the platform database (Drizzle adapter,
 * provider `sqlite`: D1 on Cloudflare, `bun:sqlite` in Docker). Mounted at `/api/auth/*`.
 *
 * - Email and password always; GitHub and Google only when both their client id setting and secret exist.
 *   OAuth never creates an account and never links one implicitly: a signed-in user links a provider
 *   (`/api/auth/link-social`) and signs in with it from then on.
 * - Public sign-up is closed (`/sign-up/email` answers 404): the setup and invite routes create accounts
 *   through the server API. The first user ever created becomes `owner`, every later one `viewer` until
 *   the invite that created it sets its role.
 * - Sessions live in the database behind an httpOnly, Secure, SameSite=Lax cookie
 *   (`__Secure-uptellis.session_token`); no cookie cache, so a role change or removal applies at once.
 * - The JWT plugin issues short-lived tokens (`/api/auth/token`) that other services verify against
 *   `/api/auth/jwks`.
 * - Rate limits are Uptellis' own (src/worker/middleware/rate-limit.ts), so Better Auth's are off.
 *
 * Without `BETTER_AUTH_SECRET` there are no accounts: `createAuth` returns null and everyone is anonymous.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins/jwt";
import { count } from "drizzle-orm";
import type { Platform } from "@/platform/types";
import type { Role } from "@/shared/auth";
import { type AuthProviders, PASSWORD_MAX, PASSWORD_MIN } from "@/shared/schemas/auth";
import { accounts, jwks, sessions, users, verifications } from "../db/schema";
import { COOKIE_PREFIX } from "./cookies";

/** What accounts need from the platform. */
export type AuthPlatform = Pick<Platform, "db" | "batch" | "secret" | "setting" | "now">;

export const AUTH_BASE_PATH = "/api/auth";

/** Lifetime of an issued JWT. */
export const JWT_TTL = "15m";

/** Better Auth's models under the names its Drizzle adapter looks up. */
const models = { user: users, session: sessions, account: accounts, verification: verifications, jwks };

/** The instance's public URL: the `PUBLIC_URL` setting, else the request's origin (local dev). */
export function baseUrl(p: Pick<Platform, "setting">, requestUrl: string): string {
  const configured = p.setting("PUBLIC_URL");
  return new URL(configured ? configured : requestUrl).origin;
}

/** The OAuth providers with both a client id and a secret configured. */
function oauth(p: AuthPlatform) {
  const github = { id: p.setting("GITHUB_CLIENT_ID"), secret: p.secret("GITHUB_CLIENT_SECRET") };
  const google = { id: p.setting("GOOGLE_CLIENT_ID"), secret: p.secret("GOOGLE_CLIENT_SECRET") };
  const on = (c: { id?: string; secret?: string }) => Boolean(c.id && c.secret);
  const provider = (c: { id?: string; secret?: string }) => ({
    clientId: c.id ?? "",
    clientSecret: c.secret ?? "",
    disableSignUp: true,
  });
  return {
    enabled: { github: on(github), google: on(google) },
    providers: {
      ...(on(github) ? { github: provider(github) } : {}),
      ...(on(google) ? { google: provider(google) } : {}),
    },
  };
}

/** Which sign-in methods this instance offers. */
export const authProviders = (p: AuthPlatform): AuthProviders => ({
  emailPassword: true,
  ...oauth(p).enabled,
});

export async function userCount(p: Pick<Platform, "db">): Promise<number> {
  const [row] = await p.db.select({ n: count() }).from(users);
  return row?.n ?? 0;
}

function build(p: AuthPlatform, secret: string, baseURL: string) {
  return betterAuth({
    appName: "Uptellis",
    baseURL,
    basePath: AUTH_BASE_PATH,
    secret,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(p.db, { provider: "sqlite", schema: models }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      autoSignIn: true,
    },
    disabledPaths: ["/sign-up/email"],
    socialProviders: oauth(p).providers,
    account: { accountLinking: { enabled: true, disableImplicitLinking: true } },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "viewer", input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const role: Role = (await userCount(p)) === 0 ? "owner" : "viewer";
            return { data: { ...user, role } };
          },
        },
      },
    },
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      useSecureCookies: true,
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: "lax" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
    plugins: [
      jwt({
        jwt: {
          issuer: baseURL,
          audience: baseURL,
          expirationTime: JWT_TTL,
          definePayload: ({ user }) => ({ role: user.role as Role }),
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof build>;

/** Better Auth for a request to `requestUrl`, or null when `BETTER_AUTH_SECRET` is not set. */
export function createAuth(p: AuthPlatform, requestUrl: string): Auth | null {
  const secret = p.secret("BETTER_AUTH_SECRET");
  return secret ? build(p, secret, baseUrl(p, requestUrl)) : null;
}
