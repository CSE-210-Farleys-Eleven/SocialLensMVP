# adapters: input / output contract

Owner: Ekansh. Source of truth for types: [`src/adapters/contract.ts`](../../src/adapters/contract.ts).
Schema version: **1**. Read-only: the adapters never write to any network.

## One function

```ts
import { collect } from 'src/adapters';
const result: AdapterResult = await collect(request, { pipeline?, context? });
```

`collect` **never rejects**. Failures become entries in `result.issues`.

## Input: `AdapterRequest`

| Field | Type | From | Notes |
|---|---|---|---|
| `subject.did` | `did:plc:…` / `did:web:host` | accounts | Preferred. |
| `subject.handle` | string | accounts / UI | Used if no DID; resolved to a DID. At least one of did/handle is required. |
| `subject.pdsUrl` | https origin | accounts | Hint only; the DID document wins. |
| `collections` | `string[]` (NSIDs) | **registry** | Which collections to read. Omit to discover all via `describeRepo`. |
| `session` | `{ did, fetch?, accessToken? }` | **auth** | Optional. Public data needs no sign-in. Credentials are only ever sent to the PDS of `session.did`, and never to the AppView. A session for a different DID is ignored with a warning. |
| `options.maxRecordsPerCollection` | number (1000) | | Cap per collection. |
| `options.order` | `'newest-first'` (default) / `'oldest-first'` | | Which end survives the cap. |
| `options.includeEngagement` | boolean (true) | | Like/reply/repost counts. |
| `options.includeIdentityHistory` | boolean (true) | | PLC audit log: creation date, past handles. |
| `options.maxConcurrentCollections` | number (3) | | |

Auth owners: giving us a `session.fetch` (the OAuth client's authenticated fetch) is
preferred over a raw token, because DPoP-bound tokens can't be replayed as a bearer.

## Output: `AdapterResult`

```jsonc
{
  "schemaVersion": 1,
  "subject": { "did": "did:plc:…", "handle": "alice.test", "pdsUrl": "https://…" },
  "fetchedAt": "2026-01-01T00:00:00.000Z",
  "items": [ /* ONE flat list, all sources mixed. Discriminate on item.kind */ ],
  "issues": [ { "source": "bluesky", "code": "rate-limited", "severity": "error", "message": "…", "retryable": true } ],
  "coverage": [ { "source": "atproto", "collection": "app.bsky.feed.post", "fetched": 150, "complete": false, "reason": "record-cap" } ],
  "adapters": ["atproto", "bluesky"],
  "complete": false
}
```

### `items` (all carry `source` and `fetchedAt`)

| `kind` | From | Contents |
|---|---|---|
| `identity` | atproto | did, didMethod, handle, handleVerified, pdsUrl, createdAt, handleHistory |
| `record` | atproto | collection, rkey, uri, cid, **raw** `value` (untouched; `normalize` interprets it) |
| `profile-stats` | bluesky | followers/follows/posts counts, displayName, createdAt |
| `engagement` | bluesky | per post `uri`: likeCount, repostCount, replyCount, quoteCount |

`normalize` joins `engagement` to its post `record` by `uri`.

### What `normalize` / `analytics` can rely on

* `items` is the only place data lives; its order is not meaningful.
* A missing source is **absence + an issue + incomplete coverage**, never a throw and never silent zeros.
* `coverage[].complete === true` means we know we reached the end. Otherwise `reason` is
  `record-cap | error | aborted | not-indexed`. **Label numbers from incomplete collections as partial.**
* A collection that exists in the request but not in the repo is `fetched: 0, complete: true` (a real zero).
* `engagement` counts are the AppView's view at `fetchedAt`; they exclude posts it has not indexed.
* `result.complete` is true iff there is no `error` issue and every coverage entry is complete.
* The whole result is plain JSON (safe for postMessage / Worker).
* Issue messages are user-safe: no tokens, no full URLs.

### Issue codes

`invalid-request, invalid-did, unsupported-did-method, not-found, rate-limited, timeout, network, http-error,
bad-request, bad-response, auth-required, unsafe-url, handle-mismatch, session-mismatch, pds-unverified,
not-indexed, aborted, adapter-crashed`

## Sub-adapters

| Adapter | Talks to | Does |
|---|---|---|
| `atproto` | plc.directory, did:web hosts, the user's PDS | handle→DID, DID doc, PDS address (validated: public https only), PLC history, `describeRepo`, paged `listRecords` (100/page); only accepts records provably in this DID's repo and this collection |
| `bluesky` | public AppView (`public.api.bsky.app`) | `getProfile` counters; `getPosts` in batches of 25 for the post URIs atproto found; falls back to `getAuthorFeed` if there are no upstream records. No credentials ever sent. |
| `fixtures` | nothing | deterministic synthetic account, scenarios `typical, empty, appview-down, rate-limited, pds-down`. Items say `source: 'fixtures'`. |

## Swapping live and fixtures

```ts
collect(req, { pipeline: createLivePipeline() });                 // default
collect(req, { pipeline: createFixturePipeline('typical') });     // offline demos/tests
collect(req, { context: { fetch: createFixtureFetch().fetch } }); // live code, fake network
```

## Context

`context` accepts `fetch`, `signal` (AbortSignal), `timeoutMs` (10s), `maxRetries` (2),
`maxRetryAfterMs` (5s; a longer Retry-After is reported, not awaited), `endpoints`, `now`, `sleep`.

## Out of scope for this module

Writes, OAuth, account registry, schema normalization, analytics, network-wide indexes (Constellation/ClearSky),
anything about accounts other than the requested one.
