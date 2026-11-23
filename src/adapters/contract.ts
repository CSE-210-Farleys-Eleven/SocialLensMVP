/**
 * Adapters module: public contract.
 *
 * This file is the ONLY thing other modules should import from `adapters`
 * (`import type { ... } from '../adapters/contract'`). It has no runtime code
 * except two constants. See transition/adapters/README.md for the prose version.
 *
 * Shape of the module:
 *
 *   AdapterRequest --> collect() --> AdapterResult
 *   (from registry + auth)           (one flat list for `normalize`)
 *
 * Design rules:
 *  1. ONE output collection. Every adapter's items land in the same
 *     `items` array, tagged with `source` + `kind`. Normalize never has to
 *     know which pipeline produced what.
 *  2. Partial failure is data, not an exception. Anything that goes wrong
 *     becomes an `AdapterIssue`; `collect()` itself never rejects.
 *  3. Honest completeness. `coverage` says, per collection, how much was read
 *     and why reading stopped, so analytics can label numbers as partial.
 *  4. Read-only. No adapter writes to any network.
 *  5. Independent. Nothing here imports another module.
 */

export const ADAPTERS_SCHEMA_VERSION = 1 as const;
/** Adapter ids that may appear in `source`. */
export const SOURCE_IDS = ['atproto', 'bluesky', 'fixtures'] as const;

export type SourceId = (typeof SOURCE_IDS)[number];
export type Did = string; // did:plc:... or did:web:...
export type AtUri = string; // at://did/collection/rkey
export type Nsid = string; // e.g. app.bsky.feed.post
export type IsoDateTime = string; // ISO 8601, UTC

// ---------------------------------------------------------------------------
// INPUT
// ---------------------------------------------------------------------------

/**
 * What we expect from the `auth` module (Sritha). Everything is optional:
 * the adapters only read public data, so they work signed-out too.
 * A session matters only to prove "self-only" and, if `fetch` is provided,
 * to read via the user's own authenticated PDS channel.
 */
export interface AdapterSession {
  /** Verified DID of the signed-in user. */
  did: Did;
  /**
   * An authenticated fetch (e.g. the OAuth session's fetchHandler, which
   * handles DPoP). Used ONLY for requests to this DID's own PDS.
   */
  fetch?: typeof fetch;
  /** Plain bearer token alternative, used ONLY for this DID's own PDS. */
  accessToken?: string;
}

/**
 * Who to read. At least one of `did` / `handle` is required.
 * (Accounts/registry normally supply `did`.)
 */
export interface SubjectRef {
  did?: Did;
  handle?: string;
  /**
   * Hint only, used when the DID document cannot be resolved. A PDS found in
   * the DID document always wins. Must be an https origin.
   */
  pdsUrl?: string;
}

export interface AdapterOptions {
  /** Max records read per collection. Default 1000. */
  maxRecordsPerCollection?: number;
  /**
   * Which end to keep when `maxRecordsPerCollection` truncates a collection.
   * Default 'newest-first' (recent activity matters most for analytics).
   */
  order?: 'newest-first' | 'oldest-first';
  /** Collections read in parallel. Default 3. */
  maxConcurrentCollections?: number;
  /** Fetch like/reply/repost counts from the public AppView. Default true. */
  includeEngagement?: boolean;
  /** Fetch creation date and past handles from the PLC audit log. Default true. */
  includeIdentityHistory?: boolean;
}

/** The single input to `collect()`. */
export interface AdapterRequest {
  subject: SubjectRef;
  /**
   * From the registry: which collections (NSIDs) to read. If omitted, the
   * adapter discovers every collection in the repo via describeRepo.
   */
  collections?: Nsid[];
  session?: AdapterSession;
  options?: AdapterOptions;
}

// ---------------------------------------------------------------------------
// OUTPUT: items
// ---------------------------------------------------------------------------

interface ItemBase {
  source: SourceId;
  /** When this item was read from the network (or generated, for fixtures). */
  fetchedAt: IsoDateTime;
}

/** The "identity card": DID, server, creation date, past handles. */
export interface IdentityItem extends ItemBase {
  kind: 'identity';
  did: Did;
  didMethod: 'plc' | 'web';
  /** Handle claimed by the DID document, or null if none. */
  handle: string | null;
  /** True if handle -> DID resolution agrees; null if it could not be checked. */
  handleVerified: boolean | null;
  pdsUrl: string | null;
  /** First PLC operation date. null for did:web or if the log was unavailable. */
  createdAt: IsoDateTime | null;
  /** Handles seen in the PLC audit log, oldest first. null if unavailable. */
  handleHistory: { handle: string; firstSeenAt: IsoDateTime }[] | null;
}

/** One raw repo record, exactly as stored on the user's PDS. */
export interface RecordItem extends ItemBase {
  kind: 'record';
  collection: Nsid;
  rkey: string;
  uri: AtUri;
  cid: string;
  /** The record body, untouched. `normalize` interprets it. */
  value: unknown;
}

/** Public profile counters (Bluesky AppView). */
export interface ProfileStatsItem extends ItemBase {
  kind: 'profile-stats';
  did: Did;
  handle: string;
  displayName: string | null;
  followersCount: number | null;
  followsCount: number | null;
  postsCount: number | null;
  createdAt: IsoDateTime | null;
}

/** Engagement counters for one post (Bluesky AppView). */
export interface EngagementItem extends ItemBase {
  kind: 'engagement';
  uri: AtUri;
  cid: string;
  likeCount: number;
  repostCount: number;
  replyCount: number;
  /** null if the AppView did not report it. */
  quoteCount: number | null;
  indexedAt: IsoDateTime | null;
}

export type AdapterItem = IdentityItem | RecordItem | ProfileStatsItem | EngagementItem;

// ---------------------------------------------------------------------------
// OUTPUT: issues + coverage
// ---------------------------------------------------------------------------

export type IssueCode =
  | 'invalid-request'
  | 'invalid-did'
  | 'unsupported-did-method'
  | 'not-found'
  | 'rate-limited'
  | 'timeout'
  | 'network'
  | 'http-error'
  | 'bad-request'
  | 'bad-response'
  | 'auth-required'
  | 'unsafe-url'
  | 'handle-mismatch'
  | 'session-mismatch'
  | 'pds-unverified'
  | 'not-indexed'
  | 'aborted'
  | 'adapter-crashed';

export interface AdapterIssue {
  source: SourceId | 'collector';
  code: IssueCode;
  /** error: data is missing/wrong. warning: degraded. info: FYI. */
  severity: 'info' | 'warning' | 'error';
  /** Plain-language, safe to show a user. Never contains tokens. */
  message: string;
  /** Whether retrying later might succeed. */
  retryable: boolean;
  collection?: Nsid;
  httpStatus?: number;
}

export type CoverageReason = 'record-cap' | 'error' | 'aborted' | 'not-indexed';

export interface CoverageEntry {
  source: SourceId;
  /** Collection NSID, or a label like 'engagement' for non-collection reads. */
  collection: string;
  fetched: number;
  /** True only if we know we reached the end. */
  complete: boolean;
  /** Present when `complete` is false. */
  reason?: CoverageReason;
}

/** What one adapter returns to the collector. */
export interface AdapterOutput {
  items: AdapterItem[];
  issues: AdapterIssue[];
  coverage: CoverageEntry[];
}

/** What `collect()` returns: the single combined collection. */
export interface AdapterResult {
  schemaVersion: typeof ADAPTERS_SCHEMA_VERSION;
  subject: { did: Did | null; handle: string | null; pdsUrl: string | null };
  fetchedAt: IsoDateTime;
  items: AdapterItem[];
  issues: AdapterIssue[];
  coverage: CoverageEntry[];
  /** Adapter ids that ran. */
  adapters: string[];
  /** True iff no `error` issues and every coverage entry is complete. */
  complete: boolean;
}

// ---------------------------------------------------------------------------
// PORTS (for swapping live <-> fixtures, and for tests)
// ---------------------------------------------------------------------------

export interface AdapterContext {
  fetch: typeof fetch;
  signal?: AbortSignal;
  now: () => Date;
  endpoints: {
    /** Default https://plc.directory */
    plcDirectory: string;
    /** Default https://public.api.bsky.app */
    appView: string;
  };
  /** Per-request timeout. Default 10_000. */
  timeoutMs: number;
  /** Retries on timeout / network / 5xx / 429. Default 2. */
  maxRetries: number;
  /** Longest Retry-After we will wait for. Default 5_000; above that, give up. */
  maxRetryAfterMs: number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Allow http / localhost / IP service URLs. Tests and local dev only. Default false. */
  allowInsecureHosts: boolean;
}

/**
 * One data source. `upstream` is everything earlier stages produced, so an
 * adapter can enrich it (bluesky reads post URIs from atproto) but must also
 * work when `upstream` is empty.
 */
export interface Adapter {
  readonly id: SourceId;
  run(
    ctx: AdapterContext,
    req: AdapterRequest,
    upstream: readonly AdapterItem[],
  ): Promise<AdapterOutput>;
}

/** Stages run in order; adapters inside one stage run in parallel. */
export type AdapterPipeline = readonly (readonly Adapter[])[];
