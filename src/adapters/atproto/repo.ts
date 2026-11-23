import type {
  AdapterContext,
  AdapterIssue,
  AdapterRequest,
  CoverageEntry,
  Nsid,
  RecordItem,
} from '../contract';
import { getJson } from '../http';
import { asString, isRecord, issue, mapPool, parseAtUri } from '../util';

const SRC = 'atproto' as const;
const PAGE_SIZE = 100; // listRecords maximum
const DEFAULT_MAX_RECORDS = 1000;
const MAX_PAGES = 1000; // hard stop against a server that never ends

export interface RepoRead {
  items: RecordItem[];
  issues: AdapterIssue[];
  coverage: CoverageEntry[];
}

/** How to talk to this DID's PDS. Session credentials are used here and nowhere else. */
function pdsAuth(req: AdapterRequest, did: string, issues: AdapterIssue[]) {
  const s = req.session;
  if (!s) return {};
  if (s.did !== did) {
    issues.push(
      issue(SRC, 'session-mismatch', 'warning', 'The signed-in account is not the account being read; its credentials were not used.'),
    );
    return {};
  }
  if (s.fetch) return { fetch: s.fetch };
  if (s.accessToken) return { headers: { authorization: `Bearer ${s.accessToken}` } };
  return {};
}

/** com.atproto.repo.describeRepo -> list of collection NSIDs. */
export async function describeRepo(
  ctx: AdapterContext,
  pds: string,
  did: string,
  auth: ReturnType<typeof pdsAuth> = {},
) {
  const r = await getJson<unknown>(
    ctx,
    `${pds}/xrpc/com.atproto.repo.describeRepo?repo=${encodeURIComponent(did)}`,
    { source: SRC, label: 'describe repo', ...auth },
  );
  if (!r.ok) return { collections: null, issue: r.issue };
  const cols = isRecord(r.value) && Array.isArray(r.value.collections) ? r.value.collections : null;
  if (!cols) {
    return { collections: null, issue: issue(SRC, 'bad-response', 'error', 'describe repo returned no collection list.') };
  }
  return { collections: cols.filter((c): c is string => typeof c === 'string').sort(), issue: null };
}

/** Page through one collection until the end or the record cap. */
async function readCollection(
  ctx: AdapterContext,
  pds: string,
  did: string,
  collection: Nsid,
  cap: number,
  auth: ReturnType<typeof pdsAuth>,
  newestFirst: boolean,
): Promise<RepoRead> {
  const items: RecordItem[] = [];
  const issues: AdapterIssue[] = [];
  let cursor: string | undefined;
  let skipped = 0;
  let complete = false;
  let reason: CoverageEntry['reason'];

  for (let page = 0; page < MAX_PAGES; page++) {
    const limit = Math.min(PAGE_SIZE, cap - items.length);
    if (limit <= 0) {
      reason = 'record-cap';
      break;
    }
    const qs = new URLSearchParams({ repo: did, collection, limit: String(limit) });
    if (newestFirst) qs.set('reverse', 'true');
    if (cursor) qs.set('cursor', cursor);
    const r = await getJson<unknown>(ctx, `${pds}/xrpc/com.atproto.repo.listRecords?${qs}`, {
      source: SRC,
      label: `read ${collection}`,
      collection,
      ...auth,
    });
    if (!r.ok) {
      issues.push(r.issue);
      reason = r.issue.code === 'aborted' ? 'aborted' : 'error';
      break;
    }
    const body = r.value;
    const records = isRecord(body) && Array.isArray(body.records) ? body.records : null;
    if (!records) {
      issues.push(issue(SRC, 'bad-response', 'error', `${collection}: response had no record list.`, { collection }));
      reason = 'error';
      break;
    }
    const fetchedAt = ctx.now().toISOString();
    for (const rec of records) {
      const uri = isRecord(rec) ? asString(rec.uri) : null;
      const cid = isRecord(rec) ? asString(rec.cid) : null;
      const parts = uri ? parseAtUri(uri) : null;
      // Reject anything that is not provably this account's record in this collection.
      if (!isRecord(rec) || !uri || !cid || !parts || parts.did !== did || parts.collection !== collection || !isRecord(rec.value)) {
        skipped++;
        continue;
      }
      items.push({ kind: 'record', source: SRC, fetchedAt, collection, rkey: parts.rkey, uri, cid, value: rec.value });
    }
    const next = isRecord(body) ? asString(body.cursor) : null;
    if (!next || records.length === 0) {
      complete = true;
      break;
    }
    if (next === cursor) {
      issues.push(issue(SRC, 'bad-response', 'warning', `${collection}: server repeated its page cursor; stopped early.`, { collection }));
      reason = 'error';
      break;
    }
    cursor = next;
  }
  if (!complete && !reason) reason = 'record-cap';
  if (skipped > 0) {
    issues.push(issue(SRC, 'bad-response', 'warning', `${collection}: ${skipped} malformed or foreign record(s) were ignored.`, { collection }));
  }
  return {
    items,
    issues,
    coverage: [{ source: SRC, collection, fetched: items.length, complete, ...(complete ? {} : { reason }) }],
  };
}

/**
 * Read the requested collections (or all of them) from one repo.
 * `collections` from the registry may include NSIDs the repo does not have;
 * those come back as empty-and-complete, which is the honest answer.
 */
export async function readRepo(
  ctx: AdapterContext,
  req: AdapterRequest,
  pds: string,
  did: string,
): Promise<RepoRead> {
  const issues: AdapterIssue[] = [];
  const auth = pdsAuth(req, did, issues);
  const cap = Math.max(1, Math.floor(req.options?.maxRecordsPerCollection ?? DEFAULT_MAX_RECORDS));

  let collections: Nsid[] | null = req.collections ? [...new Set(req.collections)] : null;
  if (!collections) {
    const d = await describeRepo(ctx, pds, did, auth);
    if (!d.collections) {
      return { items: [], issues: [...issues, d.issue!], coverage: [{ source: SRC, collection: '(all)', fetched: 0, complete: false, reason: 'error' }] };
    }
    collections = d.collections;
  }

  const results = await mapPool(collections, req.options?.maxConcurrentCollections ?? 3, (c) =>
    readCollection(ctx, pds, did, c, cap, auth, req.options?.order !== 'oldest-first'),
  );
  return {
    items: results.flatMap((r) => r.items),
    issues: [...issues, ...results.flatMap((r) => r.issues)],
    coverage: results.flatMap((r) => r.coverage),
  };
}
