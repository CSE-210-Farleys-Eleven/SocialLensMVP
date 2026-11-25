# auth: input / output contract

Owner: Sritha. Source of truth for types: [`src/auth/contract.ts`](../../src/auth/contract.ts).
Schema version: **1**. Read-only: auth requests only the `atproto` scope (no repo writes), and the app never writes to any network.

## What auth does

Signs the user in with AT Protocol OAuth, keeps the session alive, and tells the rest
of the app **which accounts the user has proven they own**. This module defines what "self" means in
"self-only": an account is analysed only if the user signed into it in this browser.

The user can sign into several accounts (for example a personal and a work account). Each one needs its
own OAuth sign-in. There is no other way to add an account: no link records, no "add by handle".

The DID of each account comes from the OAuth token's subject, and the OAuth library checks that the
token's issuer is the authorization server that the DID's own PDS names. What the user typed is only used
to find the sign-in server.

## API

```ts
import { createBrowserAuth } from 'src/auth';

const auth = createBrowserAuth({ clientId, redirectUri });
const state = await auth.init();        // on every page load, including the redirect page; never rejects
await auth.signIn('alice.bsky.social'); // null = navigating to the provider; or an AuthIssue
auth.getSession(state.activeDid!);      // { info, fetch }, main thread only
auth.subscribe((s) => { /* drop data for DIDs no longer signed in */ });
await auth.signOut(did);                // or signOutAll()
```

| Method | Returns | Notes |
|---|---|---|
| `init()` | `Promise<AuthState>` | Finishes a pending OAuth redirect (and removes the code from the URL), restores saved sessions. Runs once; later calls return the same result. Never rejects. |
| `signIn(handleOrDid)` | `Promise<AuthIssue \| null>` | `null`: the page is navigating to the provider. Accepts `alice.bsky.social`, `@alice.bsky.social`, `did:plc:…`, `did:web:…`. Never rejects. |
| `getState()` | `AuthState` | Synchronous, plain JSON, a copy. |
| `getSession(did)` | `AuthSession \| null` | The live session, including the authenticated `fetch`. Not plain JSON. |
| `setActive(did)` | `AuthState` | Which signed-in account the UI shows. Unknown DIDs are ignored. |
| `signOut(did)` / `signOutAll()` | `Promise<AuthState>` | Never reject. The account is removed locally first; if revoking at the server fails, that is a warning issue. |
| `subscribe(listener)` | unsubscribe function | Called on every change, including expiry and sign-out in another tab. |

`createAuth(deps)` is the same service with everything injected (OAuth port, location, storage, clock);
tests use it with a fake OAuth client.

## Output: `AuthState` (plain JSON)

```jsonc
{
  "schemaVersion": 1,
  "status": "signed-in",                 // signed-out | signed-in
  "accounts": [
    {
      "status": "signed-in",
      "did": "did:plc:fixture-alice",    // from the verified token, not from what was typed
      "handle": "alice.fixture.test",    // display only; the DID if no verified handle
      "pdsUrl": "https://pds.fixture.test",
      "authServer": "https://auth.fixture.test",
      "scopes": ["atproto"],
      "signedInAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "activeDid": "did:plc:fixture-alice",  // null iff signed out
  "issues": []                           // from the most recent action
}
```

* `accounts[i]` is the registry's `SessionInfo`, field for field. Order: sign-in order.
* `status` is `signed-in` iff `accounts` is non-empty. `activeDid` is null iff signed out, otherwise one of `accounts[].did`.
* `issues` holds the issues of the most recent action (init, sign-in, sign-out, switch, expiry). Each action replaces them.
* No tokens, keys or URLs with credentials anywhere in the state or its issues.

## Output: `AuthSession` (main thread only)

```ts
{ info: SessionInfo; fetch: typeof fetch }
```

`fetch` is the account's authenticated fetch (DPoP and token refresh handled). It is a function, so it is
**not plain JSON** and not part of `AuthState`; it is handed out only by `getSession(did)`.

* It takes full URLs like `fetch`, but **only on the account's own PDS origin**. Any other origin is
  rejected with a `TypeError` and nothing is sent, so credentials cannot leak to the AppView or elsewhere.
* It stops working (rejects with a `TypeError`) once the account is signed out or its session expires,
  so a request started before sign-out cannot load data for an account that is gone.
* If the PDS answers 401 and the session cannot be refreshed, the account is signed out and subscribers
  get a `session-expired` issue.

An `AuthSession` is assignable to the registry's `AuthInput`, and its `fetch` is what the adapters
want in `AdapterSession.fetch`.

### How it reaches the adapters

Proposed (needs agreement with registry and adapters, see open questions): the registry outputs plain
JSON requests with `session: { did }` only, and the app shell attaches the function right before calling
`collect()`:

```ts
const s = auth.getSession(account.did);
const result = await collect({ ...account.request, session: s ? { did: s.info.did, fetch: s.fetch } : undefined });
```

## What consumers can rely on

* **Self-only:** every DID in `accounts` was proven by an OAuth sign-in in this browser.
* **No stale data:** `subscribe` fires on every change. When a DID leaves `accounts` (sign-out, expiry,
  sign-out in another tab) consumers must drop everything fetched for it. When `activeDid` changes, the UI
  must not show the previous account's data under the new one.
* **Never throws** for expected failures; they arrive as `AuthIssue`s.
* **Read-only:** only the `atproto` scope is requested.

### Issue codes

| Code | When |
|---|---|
| `invalid-handle` | What was typed is not a handle or a did:plc / did:web. Nothing was contacted. |
| `resolution-failed` | The handle, DID document, PDS or sign-in server could not be found or is misconfigured. |
| `cancelled` | The user denied consent at the provider. |
| `callback-failed` | The redirect came back invalid, expired, replayed or inconsistent. |
| `session-expired` | A saved session could not be restored or refreshed. Sign in again. |
| `session-revoked` | The account was signed out in another tab (`severity: info`). |
| `storage-unavailable` | The browser blocks localStorage (some private modes). Sign-in cannot work. |
| `network`, `timeout` | Could not reach a server. `retryable: true`. |
| `unexpected` | Anything else. |

Issues use the adapters' shape with `source: "auth"` and an optional `did`. Messages are fixed, user-safe
strings; the library's own error text (which can contain URLs) is never shown.

## Storage

Sessions survive a reload until the user signs out. Two things are kept in this origin's localStorage:

* the OAuth library's session data (tokens and DPoP keys) under `sociallens-oauth:*`,
* auth's own list of signed-in accounts (`sociallens-auth:v1`: DID, handle, sign-in time, active DID).

Sign-out deletes both for that account. No fetched records, analytics or profile data are stored.
Because the library uses localStorage, sessions are visible to any script on this origin; this is the
library's documented trade-off (see `@atcute/oauth-browser-client` caveats).

## Configuration

`createBrowserAuth(config)`:

| Field | Default | Notes |
|---|---|---|
| `clientId` | (required) | URL of the hosted `client-metadata.json`. For local dev, `loopbackClientId(redirectUri, 'atproto')`. |
| `redirectUri` | (required) | Must be in the client metadata's `redirect_uris`. Local dev must use `127.0.0.1`, not `localhost`. |
| `scope` | `atproto` | |
| `storageName` | `sociallens-oauth` | localStorage prefix for the library. |
| `handleResolverUrl` | `https://public.api.bsky.app` | Browsers can't do DNS, so handles are resolved through the AppView. It may log these lookups. |
| `plcUrl` | `https://plc.directory` | |

## Dependencies

`@atcute/oauth-browser-client` and `@atcute/identity-resolver`. Only `src/auth/atcute.ts` imports them,
behind the internal `OAuthPort` interface, so the library can be swapped without touching anything else.
The official `@atproto/oauth-client-browser` was the first choice but depends on `zod@3`, which has an
unfixed high-severity advisory (GHSA-mrhx-c7xc-m3w5) that fails CI's `npm audit --audit-level=high`.

## Not verified yet

* A real sign-in, refresh and sign-out against a real account (needs a hosted or loopback app page).
  Everything above is tested against a fake OAuth client only.

## Open questions

* **Accounts vs link records.** This contract makes "signed into in this browser" the only way to add an
  account. That replaces the registry's mutual-link verification (`app.sociallens.linkedAccount`, `pending`
  state). Needs agreement with Daniel (registry).
* **`fetch` across boundaries.** Proposed above: registry emits `session: { did }`, the app shell attaches
  `fetch`. Needs agreement with Daniel (registry) and Ekansh (adapters).
* **Client metadata / hosting.** Production needs a public `client-metadata.json` and a redirect URL,
  which depend on where the app is hosted.

## Out of scope for this module

Reading records, account registry, which apps/collections are analysed, analytics, any write to the
network, and accounts the user has not signed into.
