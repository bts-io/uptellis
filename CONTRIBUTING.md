# Contributing to Uptellis

Thanks for helping. This page covers how branches, commits, pull requests and releases work. By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems go through [SECURITY.md](SECURITY.md), never a public issue.

## Setup

Uptellis uses [Bun](https://bun.sh) as its only package manager and script runner (`bun`, `bunx`; not npm, npx or pnpm).

```sh
bun install
bun run collector:install
bun run dev
```

`bun run verify` runs Biome, the typechecks, the unit, integration and SSR tests and the collector tests. CI runs exactly this.

## Branches

| Branch | Holds | Receives |
| --- | --- | --- |
| `main` | Released code only; every commit on it is a release or a hotfix | Release PRs from `staging`, hotfix PRs |
| `staging` | The next release, integrated and tested | Pull requests from topic branches |
| `feat/*`, `fix/*`, `docs/*` | One change each, e.g. `feat/theme-picker`, `fix/stale-sweep`, `docs/install` | Your commits |
| `hotfix/*` | An urgent fix to the released code, cut from `main` | Your commits |

- Branch from `staging`, open the pull request against `staging`. PRs are squash-merged, so the PR title becomes the commit.
- A release PR takes `staging` to `main` (merge commit, no squash).
- A hotfix branches from `main`, is merged into `main` by PR and released, and `main` is then merged back into `staging` so the fix is not lost in the next release.

```mermaid
gitGraph
  commit id: "v0.1.0" tag: "v0.1.0"
  branch staging
  checkout staging
  branch feat/theme-picker
  checkout feat/theme-picker
  commit id: "feat: theme picker"
  checkout staging
  merge feat/theme-picker id: "squash feat"
  branch fix/stale-sweep
  checkout fix/stale-sweep
  commit id: "fix: stale sweep"
  checkout staging
  merge fix/stale-sweep id: "squash fix"
  commit id: "v0.2.0-rc.1" tag: "v0.2.0-rc.1"
  checkout main
  merge staging id: "release 0.2.0" tag: "v0.2.0"
  branch hotfix/ingest-limit
  checkout hotfix/ingest-limit
  commit id: "fix: ingest limit"
  checkout main
  merge hotfix/ingest-limit id: "release 0.2.1" tag: "v0.2.1"
  checkout staging
  merge main id: "back-merge"
```

## Commit messages

Every commit and every PR title follows [Conventional Commits](https://www.conventionalcommits.org). CI checks both with commitlint (`@commitlint/config-conventional`, see `commitlint.config.ts`). Check a message locally with:

```sh
echo "feat(admin): add revision diff" | bunx commitlint
```

The form is `type(optional scope): summary`, in the imperative, lower case, no trailing period:

| Type | Use for | Release effect |
| --- | --- | --- |
| `feat` | A new capability | Minor bump |
| `fix` | A bug fix | Patch bump |
| `perf` | A performance improvement | Patch bump |
| `docs` | Documentation only | None |
| `refactor` | Code change with no behaviour change | None |
| `test` | Tests only | None |
| `ci` | Workflows | None |
| `build` | Build system, dependencies | None |
| `chore` | Maintenance | None |
| `revert` | Reverting an earlier commit | Patch bump |

Examples:

```text
feat(themes): add a compact layout to Control Room
fix(ingest): reject payloads signed more than 120 s in the future
docs: explain the collector setup
refactor(engine): split incident derivation out of the store
ci: cache the Bun install
feat(api)!: rename /api/sites/:site/model to /api/sites/:site/snapshot

BREAKING CHANGE: clients of the model endpoint must use the new path.
```

A `!` after the type or a `BREAKING CHANGE:` footer marks a breaking change. Before 1.0 a breaking change bumps the minor version; from 1.0 on it bumps the major.

## Pull requests

Keep each PR to one change and fill in the template. Before you ask for review:

- [ ] The PR targets `staging` (or `main` for a hotfix or a release PR).
- [ ] The PR title is a Conventional Commit.
- [ ] `bun run verify` passes.
- [ ] New behaviour has tests; docs and `.dev.vars.example` match any changed configuration.
- [ ] No keys, hostnames or other private data in code, fixtures, screenshots or logs.
- [ ] Maintainers only: `bun run leak-check` passes. It scans the tree against a private denylist of names that must never appear in the public repo; it runs in the maintainers' CI and skips when no denylist is configured.

## Versioning

Uptellis follows [Semantic Versioning](https://semver.org). The version lives in `package.json` and in `.release-please-manifest.json`, and each release is tagged on `main`:

- `vX.Y.Z` on `main`: a release. Images are tagged `X.Y.Z`, `X.Y`, `X` and `latest`.
- `vX.Y.Z-rc.N` on `staging`: a release candidate, published as a GitHub pre-release. Its image gets only its full version tag.
- Every push to `staging` also publishes an image tagged `staging`.

## How releases are cut

Releases are automated with [release-please](https://github.com/googleapis/release-please). It reads the Conventional Commits since the last tag, so it needs no hand-written notes, and it keeps releases reviewable as ordinary pull requests.

1. Open a PR from `staging` to `main` titled like `chore: promote staging to main` and merge it with a merge commit.
2. On that push, release-please opens (or updates) a PR titled `chore: release X.Y.Z` that bumps `package.json` and `.release-please-manifest.json` and prepends the changes to `CHANGELOG.md`.
3. A maintainer reviews and merges it. release-please tags `vX.Y.Z` and publishes the GitHub release.
4. The release workflow builds the multi-arch container image, pushes it to GHCR with an SBOM and provenance attestation, and signs it with cosign (keyless).
5. Merge `main` back into `staging` so the version bump and changelog are there too.

For a release candidate, a maintainer tags the head of `staging` as `vX.Y.Z-rc.N` and publishes a GitHub pre-release from it; the release workflow builds its image.

The project is developed on a Forgejo instance and mirrored to GitHub. Forgejo CI runs verify, commitlint and the leak check on every push and PR to `main` and `staging`; releases and images are cut on the GitHub side, where release-please, GHCR and keyless signing are available.
