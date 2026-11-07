# Contributing

## Branches
- `dev` is the default branch. Open every pull request against `dev`.
- `main` holds released code. It only changes through a pull request from `dev`, merged by the maintainer.
- Both branches are protected: no direct pushes, no force pushes, and the `ci` checks must pass.

## Before opening a PR
- `npm test` passes locally (it builds with `tsc`, then runs the test suite).
- Commits and PR text are in English.
- Add a line to `CHANGELOG.md` and `CHANGELOG.pt-BR.md` under `[Unreleased]` for any user-visible change.
- Comments: JSDoc on modules and important functions; inline comments only where the code is hard to follow.

## CI
`ci` runs on every pull request and on pushes to `dev` and `main`: build and tests on Linux, macOS and Windows with
Node 20 and 24, plus an install from the packed tarball.
