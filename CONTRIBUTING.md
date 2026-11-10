# Contributing

## Branches
- `dev` is the default branch. Open every pull request against `dev`.
- `main` holds released code. It only changes through a pull request from `dev`, merged by the maintainer.
- Both branches are protected: no direct pushes, no force pushes, and the `ci` checks must pass.

## Before opening a PR
- `npm test` passes locally (it builds with `tsc`, then runs the test suite).
- Commits and PR text are in English. The PR title is a [Conventional Commit](https://www.conventionalcommits.org/)
  (`fix(pick): …`, `feat(agent): …`): it becomes the squash commit, and the release version is derived from it.
- Add a line to `CHANGELOG.md` and `CHANGELOG.pt-BR.md` under `[Unreleased]` for any user-visible change.
- Comments: JSDoc on modules and important functions; inline comments only where the code is hard to follow.

## CI
`ci` runs on every pull request and on pushes to `dev` and `main`: build and tests on Linux, macOS and Windows with
Node 22, 24 and 26, plus an install from the packed tarball. A PR title that isn't a Conventional Commit fails `title`.

## Releases
Versions come from the commit types since the last `v*` tag (`scripts/release.mjs`): `feat` → minor, `fix`/`perf` →
patch, `type!:` or `BREAKING CHANGE:` → major (minor while on 0.x); `chore`, `test`, `docs`, `ci` alone release nothing.
- Every push to `dev` opens or updates the `dev → main` PR, listing the commits and the version they call for.
- Before that PR is merged, the maintainer bumps `package.json` (`npm version <v> --no-git-tag-version`) and moves
  `[Unreleased]` to `## [<v>] — <date>` in both changelogs; the `version` check fails until then.
- Merging into `main` tags `v<version>`, publishes to npm (trusted publishing, with provenance) and creates the GitHub
  release from the changelog section.
