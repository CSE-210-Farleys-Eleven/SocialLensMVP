// Shared types for the accounts & registry module.

// ---------- From the adapter contract (src/adapters/contract.ts) ----------
import type {
  AdapterIssue,
  AdapterRequest,
  AdapterSession,
  IssueCode,
} from "../adapters/contract.ts";

export type { AdapterRequest, AdapterSession, IssueCode };

export type Issue = Omit<AdapterIssue, "source"> & {
  source: string;                 // here: "accounts" or "registry"
};

// ---------- Input ----------

/** The plain summary produced by auth/ (no tokens). */
export type SessionInfo = {
  status: "signed-in";
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

export type Verification =
  | "self"      // the signed-in account
  | "verified"  // both accounts list each other
  | "pending";  // only one side lists the other

export type AccountEntry = {
  did: string;
  handle: string;
  pdsUrl: string;              // hint for display; the adapter trusts the DID document
  verification: Verification;
  apps: AppEntry[];            // empty for pending accounts
  request: AdapterRequest | null; // pass straight to collect(); null for pending accounts
};

export type AccountsRegistryOutput = {
  schemaVersion: 1;
  generatedAt: string;
  accounts: AccountEntry[];          // [0] is always the signed-in account
  issues: Issue[];
  complete: boolean;                 // true iff no error issues and no skipped accounts
  timingsMs: Record<string, number>; // for throughput tests
};