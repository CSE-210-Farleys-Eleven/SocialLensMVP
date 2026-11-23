# Pull request rules

`main` is protected: nothing is pushed to it directly. Every change goes through a pull request.

## Flow

1. Branch from an up-to-date `main`: `<module>/<short-description>`, e.g. `auth/oauth-session`.
2. Make small commits following [COMMITS.md](COMMITS.md).
3. Run `npm run check` locally. It must pass before you open the PR.
4. Open the PR. The template (`.github/pull_request_template.md`) is pre-filled; fill in every section.
5. CI runs. All checks must be green.
6. Get at least one approval from someone other than the author. Prefer a reviewer from a module that consumes yours.
7. The author merges with **squash and merge** once approved and green. Delete the branch afterward.

## Title

The PR title becomes the squashed commit message, so it follows the commit format and CI checks it:

`<type>(<module>): <summary>` (add `!` after the scope for a breaking change)

## Size and scope

* Keep a PR to one module. If you must touch two (for example, you changed a contract another module consumes), say so in the description and request a review from that module's owner.
* A change to `transition/<module>/` (an input/output contract) needs approval from the owners of the modules that consume it.
* Prefer PRs a reviewer can read in 15 minutes. Split larger work.

## Reviewing

* Check behaviour against the module's contract in `transition/`, not just that the code runs.
* Look for: errors thrown instead of reported, unlabeled partial data, anything that stores or sends user data, and imports that cross module boundaries.
* Leave blocking comments as "must fix" and optional ones as "nit". The author resolves every comment before merging.

## Linking work

Link the issue the PR addresses (`Closes #N`). Each module has a tracking issue; link it even for partial work (`Refs #N`).
