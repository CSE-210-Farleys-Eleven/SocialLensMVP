/** TEMPORARY — no auth module exists on main. `session` follows the `SessionInfo` summary that
 *  SocialLensMVP PR #21 (src/registry/types.ts) expects from auth; `status` values are adapted from
 *  Test_Module_SocialLens@2b2e993 src/auth/contract.ts.
 *  Replace with `import type` from src/auth/contract once the auth module lands.
 *  Tracked in transition/ui/README.md#temporary-inputs.
 */
export interface TemporarySessionInfo {
  status: 'signed-in';
  did: string;
  handle: string;
  pdsUrl: string;
  authServer: string;
  scopes: string[];
  signedInAt: string;
}

export interface TemporaryAuthState {
  /** 'unavailable': live sign-in cannot run here (the demo still works). */
  status: 'signed-out' | 'signing-in' | 'signed-in' | 'unavailable';
  /** Present iff status is 'signed-in'. Never contains tokens. */
  session: TemporarySessionInfo | null;
  /** User-safe message from the last failed sign-in, or null. */
  failureMessage: string | null;
}
