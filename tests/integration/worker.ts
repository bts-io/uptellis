/** The integration project's Worker (`SELF`): the Hono API over the Cloudflare platform, as src/server.ts serves it. */
import { cloudflareBindings } from "@/platform/cloudflare";
import app from "@/worker/index";

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    app.fetch(request, cloudflareBindings(env, ctx), ctx),
};
