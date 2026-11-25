/**
 * Auth module: public contract.
 *
 * This file is the ONLY thing other modules should import from `auth`
 * (`import type { ... } from '../auth/contract'`). It has no runtime code
 * except constants. See transition/auth/README.md for the prose version.
 *
 * Shape of the module:
 *
 *   signIn(handle) --> provider redirect --> init() --> AuthState
 *                                                     + getSession(did) -> AuthSession
 *
 * Design rules:
 *  1. Self-only. An account is in `accounts` only after the user completed
 *     OAuth for it in this browser. The DID comes from the verified token
 *     subject, never from what the user typed.
 *  2. Several accounts may be signed in at once (each one proven by its own
 *     OAuth sign-in). There is no other way to add an account.
 *  3. Plain JSON state. `AuthState` crosses module boundaries; the
 *     authenticated `fetch` does not. It is handed out only by `getSession`,
 *     for the app shell to attach to that account's AdapterRequest.
 *  4. Expected failures are returned as `AuthIssue`s, never thrown.
 *  5. Credentials never appear in `AuthState`, issues, logs or URLs, and are
 *     only ever sent to the account's own authorization server and PDS.
 *  6. Read-only. Auth requests no scopes that allow writes to the repo.
 *  7. Independent. Nothing here imports another module at runtime.
 */

export const AUTH_SCHEMA_VERSION = 1 as const;

export type Did = string; // did:plc:... or did:web:...
export type IsoDateTime = string; // ISO 8601, UTC

// ---------------------------------------------------------------------------
// OUTPUT: plain JSON
// ---------------------------------------------------------------------------

/**
 * One signed-in account. Plain JSON, no tokens.
 * Matches the `SessionInfo` that the registry consumes.
 */
export interface SessionInfo {
  status: 'signed-in';
  /** Verified DID: the subject of the OAuth token. */
  did: Did;
  /**
   * Handle at sign-in time, resolved from the DID document. Display only.
   * Falls back to the DID if no verified handle could be resolved.
   */
  handle: string;
  /** The account's PDS (https origin) from its DID document. */
  pdsUrl: string;
  /** Authorization server (https origin) that issued the session. */
  authServer: string;
  /** Scopes actually granted. */
  scopes: string[];
  signedInAt: IsoDateTime;
}

export type AuthIssueCode =
  | 'invalid-handle' // what the user typed is not a handle or DID
  | 'resolution-failed' // handle/DID/PDS/auth server could not be resolved
  | 'cancelled' // user denied or closed the provider's consent screen
  | 'callback-failed' // redirect came back invalid, expired or tampered with
  | 'session-expired' // refresh failed; the user must sign in again
  | 'session-revoked' // signed out elsewhere or tokens revoked
  | 'storage-unavailable' // browser blocks the storage the OAuth client needs
  | 'network'
  | 'timeout'
  | 'unexpected';

/** Same shape as the adapters' issue, with `source: 'auth'`. */
export interface AuthIssue {
  source: 'auth';
  code: AuthIssueCode;
  /** error: an action failed. warning: degraded. info: FYI. */
  severity: 'info' | 'warning' | 'error';
  /** Plain-language, safe to show a user. Never contains tokens or full URLs. */
  message: string;
  /** Whether retrying later might succeed. */
  retryable: boolean;
  /** The account concerned, when there is one. */
  did?: Did;
}

/** Everything other modules may know about sign-in. Plain JSON. */
export interface AuthState {
  schemaVersion: typeof AUTH_SCHEMA_VERSION;
  /** 'signed-in' iff `accounts` is non-empty. */
  status: 'signed-out' | 'signed-in';
  /** Signed-in accounts, in sign-in order. */
  accounts: SessionInfo[];
  /** The account the UI is currently showing. null iff signed out. */
  activeDid: Did | null;
  /** Issues from the most recent action (init, sign-in, sign-out, expiry...). */
  issues: AuthIssue[];
}

// ---------------------------------------------------------------------------
// OUTPUT: not plain JSON (main thread only)
// ---------------------------------------------------------------------------

/**
 * One account's live session. NOT plain JSON (`fetch` is a function): keep it
 * on the main thread. Assignable to the registry's `AuthInput` and its
 * `fetch` to the adapters' `AdapterSession.fetch`.
 */
export interface AuthSession {
  info: SessionInfo;
  /**
   * Authenticated fetch for this account (handles DPoP and token refresh).
   * Takes full URLs like `fetch`, but only on `info.pdsUrl`'s origin: any
   * other origin is rejected with a TypeError and nothing is sent.
   */
  fetch: typeof fetch;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export type AuthListener = (state: AuthState) => void;

export interface AuthService {
  /**
   * Call once on page load. Completes a pending OAuth redirect if there is
   * one, restores existing sessions, and returns the state. Never rejects.
   */
  init(): Promise<AuthState>;

  /**
   * Start sign-in for a handle or DID. Resolves with `null` once the page is
   * navigating to the provider, or with an issue if sign-in could not start.
   * Adding a second account works the same way. Never rejects.
   */
  signIn(handleOrDid: string): Promise<AuthIssue | null>;

  /** Current state. Synchronous, plain JSON. */
  getState(): AuthState;

  /** Live session for a signed-in account, or null. Main thread only. */
  getSession(did: Did): AuthSession | null;

  /** Switch which signed-in account the UI shows. No-op for unknown DIDs. */
  setActive(did: Did): AuthState;

  /**
   * Sign out one account: revoke its tokens where the server allows and
   * forget it locally. Never rejects; a failed revoke is a warning issue, and
   * the account is still removed locally.
   */
  signOut(did: Did): Promise<AuthState>;

  /** Sign out every account. */
  signOutAll(): Promise<AuthState>;

  /**
   * Called on every state change: sign-in, sign-out, account switch, expiry
   * or revocation. Consumers MUST drop data for any DID no longer in
   * `accounts` (and re-render on `activeDid` changes) so nothing stale shows.
   * Returns an unsubscribe function.
   */
  subscribe(listener: AuthListener): () => void;
}
