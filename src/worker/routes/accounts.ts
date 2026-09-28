/**
 * Account routes (contract: src/shared/schemas/auth.ts). `accountRoutes` is mounted at `/api` and open to
 * everyone: who am I, first-run setup, and invite acceptance. `userRoutes` is mounted at `/api/admin` and
 * needs `users.manage`. Better Auth itself answers `/api/auth/*` (src/worker/index.ts).
 *
 * Setup and invite acceptance create the account through Better Auth's server API (public sign-up is
 * closed), sign it in, and answer 201 with `Me` and the session cookie. Every response is `no-store`.
 */
import { APIError } from "better-auth/api";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import { can, PERMISSIONS, type Principal } from "@/shared/auth";
import {
  AcceptInviteRequest,
  ChangeRoleRequest,
  CreateInviteRequest,
  type InviteInfo,
  type InviteList,
  type Me,
  SetupRequest,
  type SetupStatus,
  type UserList,
} from "@/shared/schemas/auth";
import { type AuthEnv, authError, principalOf, requirePermission } from "../auth/context";
import { authProviders, userCount } from "../auth/instance";
import {
  claimInvite,
  createInvite,
  deleteInvite,
  listInvites,
  pendingInvite,
  recordAcceptance,
  releaseInvite,
} from "../auth/invites";
import { changeRole, getUser, listUsers, removeUser, setRole, userByEmail, userSummary } from "../auth/users";
import { toIso } from "../db/util";
import { isSameOrigin } from "../middleware/same-origin";

type Ctx = Context<AuthEnv>;

const MAX_BODY_BYTES = 16 * 1024;

const issues = (error: z.ZodError) =>
  error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message }));

/** The JSON body parsed with `schema`, or the 400 to answer. */
async function body<T>(
  c: Ctx,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const text = await c.req.text();
  if (text.length > MAX_BODY_BYTES)
    return { ok: false, res: authError(c, 400, "invalid", "Body is too large") };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, res: authError(c, 400, "invalid", "Body is not JSON") };
  }
  const parsed = schema.safeParse(json);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, res: authError(c, 400, "invalid", "Malformed request", issues(parsed.error)) };
}

/** What `/api/me` answers for a principal. */
async function me(c: Ctx, principal: Principal): Promise<Me> {
  const { platform } = c.get("accounts");
  const user = principal.kind === "user" ? await getUser(platform, principal.userId) : null;
  return {
    user: user ? userSummary(user) : null,
    permissions: PERMISSIONS.filter((p) => can(principal, p)),
    providers: authProviders(platform),
    setupNeeded: user ? false : (await userCount(platform)) === 0,
  };
}

/** Creates and signs in an account; the Better Auth error becomes a 400. */
async function signUp(c: Ctx, input: { name: string; email: string; password: string }) {
  const auth = c.get("accounts").auth();
  if (!auth)
    return { ok: false as const, res: authError(c, 503, "unavailable", "BETTER_AUTH_SECRET is not set") };
  try {
    const out = await auth.api.signUpEmail({ body: input, headers: c.req.raw.headers, returnHeaders: true });
    return { ok: true as const, userId: out.response.user.id, headers: out.headers };
  } catch (err) {
    if (err instanceof APIError)
      return { ok: false as const, res: authError(c, 400, "invalid", err.message) };
    throw err;
  }
}

/** 201 with `Me` for the new user and its session cookie. */
async function signedIn(c: Ctx, userId: string, headers: Headers) {
  const body = await me(c, {
    kind: "user",
    userId,
    role: (await getUser(c.get("accounts").platform, userId))!.role,
  });
  const res = c.json(body, 201, { "cache-control": "no-store" });
  for (const cookie of headers.getSetCookie()) res.headers.append("set-cookie", cookie);
  return res;
}

const crossSite = (c: Ctx) => authError(c, 403, "forbidden", "Cross-site request");

export function accountRoutes() {
  const app = new Hono<AuthEnv>();

  // Mounted at `/api`: a `*` middleware here would also run for every other `/api` route.
  for (const path of ["/me", "/setup", "/invites/*"]) {
    app.use(path, async (c, next) => {
      if (c.req.method !== "GET" && c.req.method !== "HEAD" && !isSameOrigin(c.req.raw)) return crossSite(c);
      await next();
      c.res.headers.set("cache-control", "no-store");
    });
  }

  app.get("/me", async (c) => c.json(await me(c, principalOf(c))));

  app.get("/setup", async (c) =>
    c.json({ needed: (await userCount(c.get("accounts").platform)) === 0 } satisfies SetupStatus),
  );

  app.post("/setup", async (c) => {
    const { platform } = c.get("accounts");
    if ((await userCount(platform)) > 0) return authError(c, 409, "conflict", "Setup is already done");
    const req = await body(c, SetupRequest);
    if (!req.ok) return req.res;
    const created = await signUp(c, req.data);
    if (!created.ok) return created.res;
    // Two setups racing: the hook made only the first one the owner; the other account is undone.
    if ((await getUser(platform, created.userId))?.role !== "owner") {
      await removeUser(platform, "owner", created.userId);
      return authError(c, 409, "conflict", "Setup is already done");
    }
    return signedIn(c, created.userId, created.headers);
  });

  app.get("/invites/:token", async (c) => {
    const invite = await pendingInvite(c.get("accounts").platform, c.req.param("token"));
    if (!invite) return authError(c, 404, "not_found", "Unknown or expired invite");
    return c.json({
      role: invite.role,
      email: invite.email,
      expiresAt: toIso(invite.expiresAt),
    } satisfies InviteInfo);
  });

  app.post("/invites/:token/accept", async (c) => {
    const { platform } = c.get("accounts");
    const token = c.req.param("token");
    const req = await body(c, AcceptInviteRequest);
    if (!req.ok) return req.res;
    const invite = await pendingInvite(platform, token);
    if (!invite) return authError(c, 404, "not_found", "Unknown or expired invite");
    if (invite.email && invite.email.toLowerCase() !== req.data.email.toLowerCase()) {
      return authError(c, 400, "invalid", "This invite is for another address", [
        { path: "email", message: "Use the address the invite was sent to" },
      ]);
    }
    if (await userByEmail(platform, req.data.email)) {
      return authError(c, 409, "conflict", "An account with this address exists; sign in instead");
    }
    const claimed = await claimInvite(platform, token);
    if (!claimed) return authError(c, 404, "not_found", "Unknown or expired invite");
    const created = await signUp(c, req.data);
    if (!created.ok) {
      await releaseInvite(platform, claimed.id);
      return created.res;
    }
    await setRole(platform, created.userId, claimed.role);
    await recordAcceptance(platform, claimed.id, created.userId);
    return signedIn(c, created.userId, created.headers);
  });

  return app;
}

/** The acting user's role; the route runs behind `requirePermission`, so the principal is a user. */
const actorRole = (c: Ctx) => {
  const p = principalOf(c);
  return p.kind === "user" ? p.role : "viewer";
};
const actorId = (c: Ctx) => {
  const p = principalOf(c);
  return p.kind === "user" ? p.userId : "";
};

/** Users and invites under `/api/admin` (`users.manage`). */
export function userRoutes() {
  const app = new Hono<AuthEnv>();
  for (const path of ["/users", "/users/*", "/invites", "/invites/*"])
    app.use(path, requirePermission("users.manage"));

  app.get("/users", async (c) =>
    c.json({ users: await listUsers(c.get("accounts").platform) } satisfies UserList),
  );

  const refused = (c: Ctx, error: "not_found" | "forbidden" | "last_owner") => {
    if (error === "not_found") return authError(c, 404, "not_found", "Unknown user");
    if (error === "forbidden") return authError(c, 403, "forbidden", "Only an owner may change an owner");
    return authError(c, 409, "conflict", "The last owner cannot be demoted or removed");
  };

  app.patch("/users/:id", async (c) => {
    const req = await body(c, ChangeRoleRequest);
    if (!req.ok) return req.res;
    const out = await changeRole(c.get("accounts").platform, actorRole(c), c.req.param("id"), req.data.role);
    return out.ok ? c.json(out.value) : refused(c, out.error);
  });

  app.delete("/users/:id", async (c) => {
    const out = await removeUser(c.get("accounts").platform, actorRole(c), c.req.param("id"));
    return out.ok ? c.body(null, 204) : refused(c, out.error);
  });

  app.get("/invites", async (c) =>
    c.json({ invites: await listInvites(c.get("accounts").platform) } satisfies InviteList),
  );

  app.post("/invites", async (c) => {
    const req = await body(c, CreateInviteRequest);
    if (!req.ok) return req.res;
    if (req.data.role === "owner" && actorRole(c) !== "owner") {
      return authError(c, 403, "forbidden", "Only an owner may invite an owner");
    }
    const { platform, baseUrl } = c.get("accounts");
    const issued = await createInvite(
      platform,
      { role: req.data.role, email: req.data.email ?? null, createdBy: actorId(c) },
      baseUrl,
    );
    return c.json(issued, 201);
  });

  app.delete("/invites/:id", async (c) =>
    (await deleteInvite(c.get("accounts").platform, c.req.param("id")))
      ? c.body(null, 204)
      : authError(c, 404, "not_found", "Unknown invite"),
  );

  return app;
}
