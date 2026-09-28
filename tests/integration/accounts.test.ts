import { describe, expect, it } from "vitest";
import { adminCookie, handle, json, OWNER, send } from "./admin-app";

describe("smoke", () => {
  it("creates the owner", async () => {
    expect(await json(await handle("/api/setup"))).toEqual({ needed: true });
    const cookie = await adminCookie();
    const me = await json(await handle("/api/me", { headers: { cookie } }));
    expect(me.user.role).toBe("owner");
    expect((await send("/api/setup", OWNER)).status).toBe(409);
  });
});
