/**
 * Optional live, read-only smoke test of the adapters against the real network.
 *
 *   npm run smoke                 # reads the official @bsky.app account
 *   npm run smoke -- some.handle  # any PUBLIC account you are entitled to look at
 *
 * Prints counts only (no record bodies), writes nothing. Do not commit output.
 */
import { collect } from '../src/adapters';

const handle = process.argv[2] ?? 'bsky.app';
const started = Date.now();
const r = await collect(
  { subject: { handle }, options: { maxRecordsPerCollection: 150 } },
  { context: { timeoutMs: 15_000 } },
);

const byKind: Record<string, number> = {};
for (const i of r.items) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
const identity = r.items.find((i) => i.kind === 'identity');

console.log(JSON.stringify({
  handle,
  ms: Date.now() - started,
  subject: r.subject,
  complete: r.complete,
  itemsByKind: byKind,
  identity: identity && identity.kind === 'identity'
    ? { didMethod: identity.didMethod, handleVerified: identity.handleVerified, createdAt: identity.createdAt, pastHandles: identity.handleHistory?.length ?? null }
    : null,
  coverage: r.coverage.map((c) => `${c.collection}: ${c.fetched}${c.complete ? '' : ` (partial: ${c.reason})`}`),
  issues: r.issues.map((i) => `${i.severity}/${i.source}/${i.code}: ${i.message}`),
}, null, 2));
