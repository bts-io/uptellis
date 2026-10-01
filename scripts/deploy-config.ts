/**
 * Writes a deploy-specific wrangler.jsonc from the committed one plus environment variables, so one checkout
 * can deploy to any Cloudflare account without committing that account's resource ids. Run it in a
 * throwaway checkout (CI) right before `bun run deploy`; it rewrites wrangler.jsonc in place.
 *
 *   DEPLOY_NAME         Worker name (default: keep "uptellis")
 *   DEPLOY_D1_ID        D1 database_id      DEPLOY_D1_NAME  D1 database_name (default: keep)
 *   DEPLOY_KV_ID        KV namespace id
 *   DEPLOY_PUBLIC_URL   vars.PUBLIC_URL (the base URL for sign-in and cookies)
 *   DEPLOY_SITE_DEFAULT vars.SITE_DEFAULT (also turns on the committed sites/<slug>.json of that slug)
 *   DEPLOY_EMAIL_FROM   turns email channels on: the Email Service `send_email` binding `EMAIL` and
 *                       vars.EMAIL_FROM (an address on a domain onboarded to Cloudflare Email Service)
 */
const path = new URL("../wrangler.jsonc", import.meta.url).pathname;
const config = Bun.JSONC.parse(await Bun.file(path).text()) as {
  name: string;
  vars?: Record<string, string>;
  d1_databases: { binding: string; database_name: string; database_id?: string }[];
  kv_namespaces: { binding: string; id?: string }[];
  send_email?: { name: string }[];
};
const env = process.env;
const db = config.d1_databases.find((d) => d.binding === "DB");
const kv = config.kv_namespaces.find((k) => k.binding === "CACHE");
if (!db || !kv) throw new Error("wrangler.jsonc has no DB or CACHE binding");
if (env.DEPLOY_NAME) config.name = env.DEPLOY_NAME;
if (env.DEPLOY_D1_ID) db.database_id = env.DEPLOY_D1_ID;
if (env.DEPLOY_D1_NAME) db.database_name = env.DEPLOY_D1_NAME;
if (env.DEPLOY_KV_ID) kv.id = env.DEPLOY_KV_ID;
config.vars ??= {};
if (env.DEPLOY_PUBLIC_URL) config.vars.PUBLIC_URL = env.DEPLOY_PUBLIC_URL;
if (env.DEPLOY_SITE_DEFAULT) config.vars.SITE_DEFAULT = env.DEPLOY_SITE_DEFAULT;
if (env.DEPLOY_EMAIL_FROM) {
  config.vars.EMAIL_FROM = env.DEPLOY_EMAIL_FROM;
  if (!config.send_email?.some((b) => b.name === "EMAIL"))
    config.send_email = [...(config.send_email ?? []), { name: "EMAIL" }];
}
await Bun.write(path, `${JSON.stringify(config, null, 2)}\n`);
console.log(
  `wrangler.jsonc prepared for "${config.name}" (d1 ${db.database_id ? "id set" : "by name"}, kv ${kv.id ? "id set" : "provisioned"}, email ${config.send_email?.length ? "on" : "off"})`,
);
