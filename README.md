# SocialLensMVP

SocialLens (CSE 210, Group 11): a browser-first, self-only AT Protocol analytics and privacy dashboard.
Organised by module (`src/<module>`); module contracts live in `transition/`.

**Implemented here: `src/adapters`** (AT Protocol, Bluesky, fixtures). The other modules are stubs naming
their owners and expected inputs/outputs from the team doc.

```
npm install
npm run check      # tsc + vitest (no network)
npm run smoke      # optional: live read-only read of the public @bsky.app account
```

* Contract: [transition/adapters/README.md](transition/adapters/README.md)
* Types: [src/adapters/contract.ts](src/adapters/contract.ts)
* No runtime dependencies; uses the platform `fetch`. Runs in the browser and Node 20+.

Privacy stance: adapters are read-only, send credentials only to the account's own PDS, and store nothing.
