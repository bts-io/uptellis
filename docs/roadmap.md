# Roadmap

Where Uptellis is going. Today it is a status page and monitoring hub on Cloudflare Workers: producers (the Uptime Kuma collector, facts pushers, signed webhooks) and the Worker's own edge probes report into one model, rendered by three themes, with incidents, Discord cards for silent sources and an admin panel with config revisions and key rotation ([architecture.md](architecture.md)). The phases below take it to a 1.0 that runs anywhere, monitors on its own and is easy to install.

Phases 1 to 4 built the prototype. **Phase 5 is done** (0.2.0): profiles, the Docker runtime, accounts and public or private pages. **Phase 6a is done** (0.3.0): native monitors, the private-network agent, confirmation, maintenance windows and down and up cards. **Phase 6b is done** (0.4.0): notification channels (Discord, Slack, signed webhooks, ntfy, Telegram, email) and public summaries, badges and an embeddable widget. Phase 7 (packaging and v1.0.0) is next.

```mermaid
flowchart LR
  now["Prototype<br/>Cloudflare Worker,<br/>Kuma collector, facts,<br/>webhooks, edge probes"] --> p5["Phase 5 (done)<br/>Core product"]
  p5 --> p6a["Phase 6a (done)<br/>Native monitors"]
  p6a --> p6b["Phase 6b (done)<br/>Channels, public status"]
  p6b --> p7["Phase 7<br/>Packaging and v1.0.0"]
```

## Phase 5: core product (done, 0.2.0)

Make Uptellis a product anyone can run and share, not only a private dashboard.

- **Profiles.** A profile declares a system's fact groups, keys, labels, formats, thresholds, highlights and topology; a site enables profiles in its config, and themes never name a fact themselves. Built in: `generic`, `uptime-kuma`, `forgejo-ha` ([profiles.md](profiles.md)).
- **Docker runtime.** The same app on any host: one container with Bun, SQLite in place of D1, a SQLite key-value table in place of KV, and a built-in scheduler in place of Cron Triggers. Cloudflare stays a first-class target; both runtimes share the engine, the model and the themes through one platform interface.
- **Accounts with Better Auth.** Users with roles (owner, admin, viewer), first-run setup, invites, optional GitHub and Google sign-in, JWTs with a JWKS endpoint, and site-scoped API keys for producers. The viewer and admin key gates are gone.
- **Public or private pages.** Each site is public or private; private sites answer 404 to anyone without a role.

## Phase 6a: native monitors (done, 0.3.0)

Monitor without any other tool in front, while keeping the Kuma collector, facts and webhooks as sources ([monitors.md](monitors.md)).

- **Checks.** HTTP(S) with status and keyword assertions, TCP, ping and TLS certificate expiry, configured per site and edited in admin.
- **Runners.** The instance itself (`builtin`: Cloudflare's edge runs HTTP and TCP, the Docker server all four) and `uptellis-agent` inside private networks, which reports out over HTTPS with a disk buffer, so nothing inbound has to be opened.
- **Confirmation.** Retries per runner and a quorum across runners before a service is down; too few agreeing runners show degraded, never page.
- **Maintenance windows.** One-off and weekly windows in any time zone; covered services show maintenance, never downtime, and nobody is paged.
- **Cards.** Down and up cards for services, beside the stale cards for silent sources.

## Phase 6b: reach (done, 0.4.0)

- **Notification providers.** Beyond Discord: email, Slack, Microsoft Teams, Telegram, ntfy, generic signed webhooks and more, per site and per incident kind.
- **Public summaries and embeds.** An allow-list of what a public page and its JSON summary show (the field list already exists in the site config), plus embeddable status badges and widgets.

## Phase 7: packaging and v1.0.0

- **Images.** Multi-arch images on GHCR, signed, with an SBOM and provenance.
- **Deploy to Cloudflare.** A button that provisions the Worker, D1, KV and the crons in one step.
- **Docs site.** Installation for both runtimes, configuration reference, profile and theme guides, the ingest API for writing your own producer.
- **v1.0.0.** A stable config format, ingest API and theme contract under SemVer.

Plans change with feedback: open an issue to discuss a feature or to help with one.
