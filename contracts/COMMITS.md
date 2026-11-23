# Commit rules

## Format

```
<type>(<module>): <summary>

<body: what and why, wrapped at ~72 columns>

<evidence line, if the commit changes behaviour>
```

* **type**: `feat`, `fix`, `refactor`, `test`, `docs`, `ci`, `chore`.
* **module**: the folder under `src/` you touched (`adapters`, `auth`, `accounts`, `registry`, `normalize`, `analytics`, `ui`, `shared`), or `repo` for root files, `transition` for contracts.
* **summary**: imperative mood ("add", not "added"), lowercase, no trailing period, at most 72 characters.
* **body**: explain *why*, not a line-by-line of the diff. Mention anything you decided that a reader would not guess, and anything left unverified.
* **evidence line** (for `feat` and `fix`): what you ran and what it showed, e.g. `Test evidence: npm run check -> 120 passed`. If you did not run something, say "not verified".

**Breaking changes** (they drive the major version, see [RELEASES.md](RELEASES.md)): add `!` after the scope and explain in the body, e.g. `feat(adapters)!: rename AdapterResult.items to records`, with a `BREAKING CHANGE: <what consumers must change>` line.

Examples:

```
feat(adapters): add handle history to the identity card
fix(normalize): skip records with a missing createdAt instead of throwing
docs(transition): document the accounts output shape
```

## Habits

* One logical change per commit. Do not mix a refactor with a behaviour change.
* Every commit should pass `npm run check`.
* Touch only your own module's folder unless the change is agreed (see [PULL_REQUESTS.md](PULL_REQUESTS.md)). A contract change is its own commit, in `transition/<module>/`.
* Never commit secrets, tokens, `.env` files, or dumps of real account data. The repo is public.
* Do not rewrite history on `main`. On your own branch, squash or amend freely before the PR is reviewed.
* Do not commit generated files (`node_modules/`, `dist/`, `coverage/`).
