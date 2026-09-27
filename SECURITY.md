# Security policy

## Supported versions

Uptellis is before 1.0. Security fixes land on `main` and ship in the next release; only the latest release is supported.

| Version | Supported |
| --- | --- |
| Latest `0.x` release | Yes |
| Older releases | No |

## Reporting a vulnerability

Please do not open a public issue, discussion or pull request for a suspected vulnerability.

Report it privately through GitHub's private vulnerability reporting: open the [Security tab](https://github.com/borderlesstech/uptellis/security) of the repository and choose **Report a vulnerability**. Include:

- what is affected (endpoint, component, version or commit),
- how to reproduce it, with a proof of concept if you have one,
- the impact you expect (data exposed, auth bypassed, denial of service).

What happens next:

1. We acknowledge the report within 3 working days.
2. We confirm or rule out the issue and share our assessment, usually within 10 working days.
3. We fix it in private, publish a release and a GitHub security advisory, and credit you unless you ask us not to.

Please give us a reasonable time to ship a fix before you disclose anything publicly. We will not take legal action against research done in good faith that respects this policy, avoids privacy violations and service disruption, and only tests against your own deployment.

## Scope

In scope: the Uptellis Worker (status page, `/api/*`, admin), the ingest signing scheme, the collector, and the published container images.

Out of scope: findings that need a leaked admin, viewer or ingest key, missing hardening on a deployment you do not run, and reports from automated scanners without a demonstrated impact.

## Running Uptellis safely

How Uptellis is protected (threat model, gates and cookies, what is public, rate limits, headers) is described in [docs/SECURITY.md](docs/SECURITY.md). If you suspect one of your keys leaked, rotate it first, then report.
