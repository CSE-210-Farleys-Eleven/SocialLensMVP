# registry: input / output contract

Owner: Daniel. Source of truth for types: [`src/registry/types.ts`](../../src/registry/types.ts).
Schema version: **1**. Read-only: this module never writes to any network.

## One function

```ts
import { loadAccounts } from 'src/registry';
const out: AccountsRegistryOutput = await loadAccounts(auth, { adapterOptions?, fetch? });
```

`loadAccounts` **never rejects**. Failures become entries in `out.issues`.

It answers two questions for the signed-in user:

* **accounts:** which accounts to analyse (the signed-in one, plus linked accounts that link back).
* **registry:** which apps appear in each account's repo, and which of their collections we support.

It then builds one ready-to-use `AdapterRequest` per account, so the caller can pass it straight to `collect()`.

## Flow

The accounts step runs first. The registry runs inside it, once per account.

1. **Accounts (signed-in):** start from `auth.info.did`. Read the repo's collection list (`describeRepo`) and its link records, in parallel.
2. **Registry:** `buildRegistry(collections)` groups the collections by app and marks which apps are supported.
3. **Request:** `collectionsToRequest(apps)` keeps only the supported apps' collections, and the module builds the signed-in account's `AdapterRequest` (with `session`).
4. **Accounts (linked):** for each linked DID, resolve it, check that it links back (`getRecord`), and read its collection list.
5. **Registry:** for **verified** accounts only, run `buildRegistry(collections)`. Pending accounts skip this and get `apps: []`.
6. **Request:** build each verified account's `AdapterRequest` (no `session`). Pending accounts get `request: null`.

```
loadAccounts(auth)
 ├─ signed-in account → describeRepo + link records → buildRegistry → request (with session)
 └─ each linked DID   → resolve → links back? ─ yes → describeRepo → buildRegistry → request
                                              └ no  → pending, request: null
```

The accounts step decides **which accounts** are included (by link verification).
The registry decides **which collections** each account's request includes (by supported apps).

## Input: `AuthInput` + `LoadOptions`

| Field | Type | From | Notes |
|---|---|---|---|
| `auth.info.did` | `did:plc:…` / `did:web:host` | **auth** | The signed-in account. Always `accounts[0]`. |
| `auth.info.handle` | string | **auth** | Display only. |
| `auth.info.pdsUrl` | https origin | **auth** | Where the signed-in repo is read from. |
| `auth.info.status`, `authServer`, `scopes`, `signedInAt` | | **auth** | Passed through; not used for logic. |
| `auth.fetch` | `typeof fetch` | **auth** | Optional. The OAuth client's authenticated fetch. Only forwarded into the signed-in account's request, never used here. |
| `opts.adapterOptions` | `AdapterRequest['options']` | UI / app shell | Optional. Copied unchanged into every request (e.g. `maxRecordsPerCollection`). |
| `opts.fetch` | `typeof fetch` | tests | Optional. The fetch used for this module's own public reads. Defaults to the global `fetch`. |

No tokens are needed: everything this module reads is public.

## Output: `AccountsRegistryOutput`

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "accounts": [
    {
      "did": "did:plc:…",
      "handle": "alice.test",
      "pdsUrl": "https://…",
      "verification": "self",            // self | verified | pending
      "apps": [
        { "id": "app.bsky", "name": "Bluesky", "supported": true,
          "collections": ["app.bsky.feed.like", "app.bsky.feed.post"] },
        { "id": "pub.leaflet", "name": "Leaflet", "supported": false,
          "collections": ["pub.leaflet.document"] }
      ],
      "request": {                       // pass to collect(); null for pending accounts
        "subject": { "did": "did:plc:…", "handle": "alice.test", "pdsUrl": "https://…" },
        "collections": ["app.bsky.feed.like", "app.bsky.feed.post"],
        "session": { "did": "did:plc:…", "fetch": "<function>" },   // signed-in account only
        "options": { "maxRecordsPerCollection": 1000 }              // only if adapterOptions given
      }
    }
  ],
  "issues": [ { "source": "accounts", "code": "not-found", "severity": "warning", "message": "…", "retryable": false } ],
  "complete": true,
  "timingsMs": { "self": 40, "linked": 60, "total": 100 }
}
```

### `accounts[]`

| Field | Notes |
|---|---|
| `verification` | `self` = signed-in account. `verified` = both accounts hold a link record pointing at each other. `pending` = only the signed-in account points at it. |
| `apps` | Every app found in the repo, grouped by the first two NSID segments. Order: supported, known-but-unsupported, unknown; alphabetical within each. Empty for `pending`. |
| `request` | An `AdapterRequest` (see [`transition/adapters/`](../adapters/README.md)). `null` for `pending` accounts, so they can never be collected. |

### How each `request` is built

* `subject`: always `did`, `handle` and `pdsUrl` (the PDS URL is a hint; the adapter trusts the DID document).
* `collections`: every collection of a **supported** app in that repo. Unsupported apps are listed in `apps` for display but not requested.
  If this module could not list the repo, `collections` is **omitted**, so the adapter discovers collections itself.
* `session`: only on the signed-in account, as `{ did, fetch? }`. Linked accounts get none: public reads need no credentials, and the adapter ignores a session for another DID.
* `options`: copied from `opts.adapterOptions`, if given.

### What callers can rely on

* `accounts[0]` is always the signed-in account, even when every request failed.
* A linked account that can't be resolved or reached is **left out and reported as a warning issue**, never thrown.
* An account with no link records simply has no linked accounts (not an issue).
* `complete` is true iff the signed-in repo was listed, no linked account was skipped, and there is no `error` issue.
* Issue messages are user-safe: no tokens, no full URLs.
* Everything is plain JSON **except** `request.session.fetch` on the signed-in account. Keep the output on the main thread; send only adapter results to a Worker.

### Registry

`KNOWN_APPS` in [`registry.ts`](../../src/accounts-registry/registry.ts) lists the apps we recognise. Only `supported: true` apps are requested.

| `id` (NSID prefix) | Name | Supported |
|---|---|---|
| `app.bsky` | Bluesky | WIP |
| `site.standard` | Standard.site | no |
| `chat.bsky` | Bluesky (chat settings) | no |
| `pub.leaflet` | Leaflet | no |
| `sh.tangled` | Tangled | no |
| `blue.linkat` | Linkat | no |
| `app.sociallens` | Social Lens (link records) | no |

Unknown prefixes are shown with their domain as the name (`com.example` → `example.com`) and `supported: false`.
Prefixes must be confirmed against real repos (e.g. with pdsls.dev) before being marked supported.

Pure helpers (no network): `buildRegistry(collections)`, `collectionsToRequest(apps)`, `appIdOf(nsid)`, `lookupApp(appId)`.

### Issue codes

Issues use the adapters' shape and codes. `source` is `"accounts"`. All are currently `severity: "warning"`.

`network, timeout, rate-limited, not-found, bad-request, http-error, bad-response, invalid-did,
unsupported-did-method, adapter-crashed`

## Linked accounts

Link records live in collection `app.sociallens.linkedAccount`, record key = the linked DID, value `{ did, … }`.
A link counts only if it is **mutual**: A lists B and B lists A. This module only **reads** link records; creating them is out of scope.

## Requests and speed

| Step | Requests | Runs |
|---|---|---|
| Signed-in account: `describeRepo` + read link records | 2 | in parallel |
| Each linked account: resolve DID, check link back (`getRecord`), `describeRepo` | 3 | up to 4 accounts at once |

At most 10 linked accounts are loaded. Each request times out after 8 s. `timingsMs` (`self`, `linked`, `total`) is included for throughput tests.

## Tests - work in progress

```
node ....
```

Offline, over a fake network: typical (self, verified, pending, one unresolvable account) and data-server-down (never rejects; `collections` omitted; retryable issues).

## Open questions

* **Self-only / read-only rules.** Linked accounts analyse DIDs other than the signed-in one, and creating link records would need a write. Options: drop linking for the MVP, or allow only accounts the user signs into in the same session.
* **Plain JSON across boundaries.** `request.session.fetch` is a function. Alternative: output `session: { did }` only and let the app shell attach `fetch` before calling `collect()`. Needs agreement with the adapters owner.

## Out of scope for this module

Writes (including creating link records), OAuth, reading records, engagement, schema normalization, analytics,
network-wide indexes (Constellation/ClearSky), accounts that are not the signed-in account or mutually linked to it.