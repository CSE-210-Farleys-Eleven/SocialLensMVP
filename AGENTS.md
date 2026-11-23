# Agent rules for SocialLensMVP

Applies to any coding agent (Claude Code, Codex, Cursor, Copilot, others) working in this repo. Humans: the same rules are in [`contracts/`](contracts/README.md).

## Project

SocialLens reads a person's public AT Protocol (Bluesky) data in the browser and shows activity, engagement and privacy observations. Modules in `src/` are owned by different people and connected only by contracts in `transition/`. See [README.md](README.md).

## Before you change anything

1. Find out which module you were asked to work on. Work **only** in `src/<module>/` and `transition/<module>/`. Do not edit another module's files; if you need a change there, stop and tell the user.
2. Read `transition/<module>/` and the contracts of modules you consume. Do not guess at their shapes.
3. If something is ambiguous or missing from a contract, ask the user rather than inventing it.

## Module rules

* Runtime imports go only to your own module (and `shared`, once it exists). From another module you may `import type` from its `contract` file, nothing else. `npm run check` enforces this (`scripts/check-boundaries.mjs`).
* Everything a module needs from outside arrives by dependency injection (pass `fetch`, clocks, etc. in). No module reaches into another module's implementation.
* Expected failures are returned as data, not thrown. Partial or missing data must be labeled partial or unknown, never silently shown as zero.
* Data crossing a module boundary is plain JSON (no `Date`, `Map`, class instances, functions).
* Changing a module's input/output shape is a contract change: update `transition/<module>/` in the same PR and say so.

## Privacy and safety (non-negotiable)

* Read-only: no writes to any network.
* Self-only: analyse the signed-in account, not arbitrary accounts.
* Store nothing: no persistent storage of fetched records or analytics.
* Credentials are never logged, stored in the repo, put in URLs, or sent anywhere except the account's own server.
* This repo is public. Never commit secrets, tokens, `.env` files, or real account data. Fixtures use obviously fake identities (`did:plc:fixture…`, `*.fixture.test`).

## Working agreement

* Write or update tests with the change. Run `npm run check` (type check, boundary check, tests) and report the real result. If you did not run something, say so.
* Do not claim something works without evidence (command output, test results).
* Keep changes small and in scope. No drive-by refactors, no new dependencies without asking.
* Do not push to `main`; it is protected. Work on a branch and open a PR.
* Commits and PRs: follow [`contracts/COMMITS.md`](contracts/COMMITS.md) and [`contracts/PULL_REQUESTS.md`](contracts/PULL_REQUESTS.md).

## Commands

```
npm install
npm run check     # typecheck + boundaries + tests
npm test          # tests only
npm run smoke     # optional live read-only check against @bsky.app (adapters)
```
