/** TEMPORARY — copied from SocialLensMVP PR #21 (branch feature/registry_and_account) src/registry/types.ts,
 *  minus `AccountEntry.request` (holds a function, so it never reaches the ui).
 *  Replace with `import type` from src/registry/contract once PR #21 merges.
 *  Tracked in transition/ui/README.md#temporary-inputs.
 */
import type { AdapterIssue } from '../../adapters/contract';

export interface TemporaryAppEntry {
  id: string;
  name: string;
  supported: boolean;
  collections: string[];
}

export type TemporaryVerification = 'self' | 'verified' | 'pending';

export interface TemporaryAccountEntry {
  did: string;
  handle: string;
  pdsUrl: string;
  verification: TemporaryVerification;
  apps: TemporaryAppEntry[];
}

export interface TemporaryAccountsOutput {
  schemaVersion: 1;
  generatedAt: string;
  /** [0] is always the signed-in account. */
  accounts: TemporaryAccountEntry[];
  issues: (Omit<AdapterIssue, 'source'> & { source: string })[];
  complete: boolean;
}
