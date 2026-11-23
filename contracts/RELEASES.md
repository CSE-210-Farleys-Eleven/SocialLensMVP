# Releases and versioning

We use [Semantic Versioning](https://semver.org): `MAJOR.MINOR.PATCH`. The version lives in `package.json`; a release is a git tag `vX.Y.Z` plus a GitHub Release with generated notes.

## What bumps what

The commit types in [COMMITS.md](COMMITS.md) decide the bump. Take the highest one since the last release.

| Change since last release | Bump |
|---|---|
| Any commit marked breaking (`feat(adapters)!:` or a `BREAKING CHANGE:` line), or an incompatible change to a contract in `transition/` | **MAJOR** |
| Any `feat` | **MINOR** |
| Only `fix`, `refactor`, `test`, `docs`, `ci`, `chore` | **PATCH** |

Before `1.0.0` (the current phase), the same rules apply one level down: a breaking change bumps MINOR, a `feat` or `fix` bumps PATCH. We go to `1.0.0` when the team agrees the MVP is stable.

A contract is "incompatible" if a consumer written against the old one would break: a removed or renamed field, a changed meaning, a new required input. Adding an optional field is not breaking.

## How to cut a release

1. Open a PR that only bumps the version: `npm version <X.Y.Z> --no-git-tag-version`, title `chore(repo): release X.Y.Z`. Get it reviewed and merged like any PR.
2. On GitHub: **Actions > release > Run workflow**, on `main`, enter the same `X.Y.Z` (tick pre-release for `-rc.1` style versions).
3. The workflow checks the version is valid semver, matches `package.json`, is higher than the latest tag and not already taken, runs `npm run check`, then creates the tag and a GitHub Release with auto-generated notes (merged PR titles).

Never tag by hand or edit a published tag. If a release is bad, ship a new patch.
