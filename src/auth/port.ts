/**
 * The seam between auth's logic (service.ts) and the OAuth library
 * (atcute.ts). Internal to the auth module: not part of the contract.
 * Tests replace it with a fake so they never touch the network or storage.
 */
import type { AuthIssueCode } from './contract';

/** What auth was doing when an error was raised. Lets `classify` tell a bad callback from a failed sign-in. */
export type Phase = 'sign-in' | 'callback' | 'restore' | 'sign-out' | 'request';

/** One live OAuth session, as the library sees it. */
export interface PortSession {
  /** Token subject: the verified DID. */
  did: string;
  /** PDS the token is for (https origin). */
  pdsUrl: string;
  /** Authorization server issuer. */
  authServer: string;
  /** Granted scopes. */
  scopes: string[];
  /**
   * Authenticated request to `pdsUrl` + `pathAndQuery` (DPoP + refresh).
   * Resolves with the response, including 401s; rejects only on network-level failure.
   */
  handle(pathAndQuery: string, init?: RequestInit): Promise<Response>;
}

export interface OAuthPort {
  /** Build the provider URL for a handle or DID. Rejects on resolution/PAR failure. */
  authorizationUrl(identifier: string, scope: string): Promise<string>;
  /** Exchange the redirect parameters for a session. Rejects on any failure. */
  finalize(params: URLSearchParams): Promise<PortSession>;
  /** Load a stored session without network. Rejects if it is gone. */
  restore(did: string): Promise<PortSession>;
  /** DIDs with a stored session. Never throws (empty if storage is unavailable). */
  storedDids(): string[];
  /** Verified handle for a DID, or null. Never rejects. */
  resolveHandle(did: string): Promise<string | null>;
  /**
   * Whether the session can still be used, refreshing it if needed. false only
   * when the server says it is revoked/expired; unknown (network) counts as true.
   */
  isAlive(did: string): Promise<boolean>;
  /** Revoke at the server. Always forgets locally, even if it rejects. */
  signOut(did: string): Promise<void>;
  /** Forget locally without contacting the server. Never throws. */
  forget(did: string): void;
  /** Map a library/network error to an issue code. */
  classify(err: unknown, phase: Phase): { code: AuthIssueCode; retryable: boolean };
}
