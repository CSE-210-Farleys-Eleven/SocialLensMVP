// Shared types for the accounts & registry module.

// ---------- From the adapter contract (src/adapters/contract.ts) ----------
import type {
  AdapterIssue,
  AdapterRequest,
  AdapterSession,
  IssueCode,
} from '../adapters/contract';

export type { AdapterRequest, AdapterSession, IssueCode };

/** Same shape as the adapters' issues, from this module. */
export type Issue = Omit<AdapterIssue, 'source'> & {
  source: 'registry';
};

// ---------- Input ----------

/** The plain summary produced by auth/ (no tokens). */
export type SessionInfo = {
  status: 'signed-in';
  did: string;
  handle: string;
  pdsUrl: string;
  authServer: string;
  scopes: string[];
  signedInAt: string;
};

/** What auth/ hands this module: the summary plus, optionally, its authenticated fetch. */
export type AuthInput = {
  info: SessionInfo;
  fetch?: typeof fetch;
};

/** Injected dependencies and settings for loadAccounts. */
export type LoadOptions = {
  adapterOptions?: AdapterRequest['options']; // copied into every request
  fetch?: typeof fetch;                       // public reads; defaults to global fetch
  now?: () => Date;                           // clock; defaults to () => new Date()
  signal?: AbortSignal;                       // lets the caller cancel all requests
};

// ---------- Registry ----------

/** One app we know about. */
export type KnownApp = {
  id: string;          // reversed-domain prefix, e.g. "app.bsky"
  name: string;        // display name, e.g. "Bluesky"
  supported: boolean;  // true = normalize/analytics handle it, so we request its collections
};

/** An app found in one account's repo. */
export type AppEntry = {
  id: string;
  name: string;
  supported: boolean;
  collections: string[];   // NSIDs present in the repo for this app
};

// ---------- Output ----------

/** MVP is self-only: the signed-in account. */
export type Verification = 'self';

export type AccountEntry = {
  did: string;
  handle: string;              // from auth; the adapters' identity item reports whether it is verified
  pdsUrl: string;              // hint only; the adapter trusts the DID document
  verification: Verification;
  apps: AppEntry[];            // empty if the repo couldn't be listed
  request: AdapterRequest;     // pass straight to collect()
};

/** Output of loadAccounts (signed-in account only). */
export type AccountsRegistryOutput = {
  schemaVersion: 1;
  generatedAt: string;
  accounts: AccountEntry[];          // exactly one: the signed-in account
  issues: Issue[];
  complete: boolean;                 // true iff the signed-in repo was listed and there is no error issue
  timingsMs: Record<string, number>; // for throughput tests
};