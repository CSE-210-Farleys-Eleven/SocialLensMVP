import type { Adapter, AdapterItem, AdapterOutput } from '../contract';
import { resolveIdentity } from './identity';
import { readRepo } from './repo';

/**
 * AT Protocol adapter: identity card + raw repo records. Read-only.
 * Talks to plc.directory / did:web hosts and the user's own PDS.
 */
export function createAtprotoAdapter(): Adapter {
  return {
    id: 'atproto',
    async run(ctx, req): Promise<AdapterOutput> {
      const out: AdapterOutput = { items: [], issues: [], coverage: [] };
      const id = await resolveIdentity(ctx, req);
      out.issues.push(...id.issues);
      if (id.item) out.items.push(id.item as AdapterItem);
      if (!id.did || !id.item?.pdsUrl) return out;

      const repo = await readRepo(ctx, req, id.item.pdsUrl, id.did);
      out.items.push(...repo.items);
      out.issues.push(...repo.issues);
      out.coverage.push(...repo.coverage);
      return out;
    },
  };
}

export { resolveIdentity, resolveHandle, fetchDidDocument, fetchPlcHistory } from './identity';
export { readRepo, describeRepo } from './repo';
