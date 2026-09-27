<!-- The PR title becomes the squash commit on staging, so it must be a Conventional Commit, e.g. "feat(admin): add revision diff". -->

## What and why

<!-- What this changes and the problem it solves. Link the issue: "Closes #123". -->

## How it was tested

<!-- Commands run, pages checked, screenshots for UI changes. -->

## Checklist

- [ ] The PR targets `staging` (or `main` only for a hotfix or a release PR).
- [ ] The title follows Conventional Commits (`feat:`, `fix:`, `docs:`, ...; `!` for a breaking change).
- [ ] `bun run verify` passes locally.
- [ ] Tests cover the change (unit, integration or SSR, whichever fits).
- [ ] Docs and `.dev.vars.example` are updated if behaviour, configuration or secrets changed.
- [ ] No keys, hostnames or other private data in code, fixtures, screenshots or logs.
- [ ] Maintainers: `bun run leak-check` passes.
