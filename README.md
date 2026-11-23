# SocialLensMVP

SocialLens (CSE 210, Group 11): a browser-first dashboard that reads a person's public AT Protocol (Bluesky) data and shows activity, engagement and privacy-relevant observations.

## How it works

Data flows one way through independent modules in `src/`:

```
auth ──► accounts / registry ──► adapters ──► normalize ──► analytics ──► ui
```

| Module | Role |
|---|---|
| `auth` | Sign-in and sessions |
| `accounts`, `registry` | Linked accounts (by DID); which apps and collections are supported |
| `adapters` | Read the network: AT Protocol repo and identity, Bluesky engagement counts, offline fixtures |
| `normalize` | App-specific records to one shared model |
| `analytics` | Activity and engagement calculations |
| `ui` | Views and components |
| `shared` | Types, errors, helpers, config |

Modules talk only through the contracts in [`transition/`](transition/README.md). Currently implemented: `adapters`.

## Run

```
npm install
npm run check      # type check, module-boundary check, tests (no network)
npm run smoke      # optional: live read-only read of the public @bsky.app account
```

## Contributing

See [`contracts/`](contracts/README.md) for pull request and commit rules, and [`AGENTS.md`](AGENTS.md) if you are running a coding agent here.
