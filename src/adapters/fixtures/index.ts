import type { Adapter, AdapterItem, AdapterOutput } from '../contract';
import {
  FIXTURE_CREATED_AT,
  FIXTURE_HANDLE_CHANGED_AT,
  FIXTURE_OLD_HANDLE,
  FIXTURE_PDS,
  buildDataset,
  type FixtureScenario,
} from './data';

/**
 * Fixtures adapter: serves the synthetic account directly, with no HTTP.
 * Drop-in replacement for the live pipeline (`createFixtureAdapters`), so
 * demos and other modules' tests run offline. It ignores the request's
 * subject on purpose: the fixture account is the only one that exists.
 *
 * Every item has `source: 'fixtures'` so nothing synthetic can be mistaken
 * for live data downstream.
 */
export function createFixturesAdapter(scenario: FixtureScenario = 'typical'): Adapter {
  return {
    id: 'fixtures',
    async run(ctx, req): Promise<AdapterOutput> {
      const ds = buildDataset(scenario);
      const fetchedAt = ctx.now().toISOString();
      const wanted = req.collections ? new Set(req.collections) : null;
      const out: AdapterOutput = { items: [], issues: [], coverage: [] };

      if (scenario === 'pds-down') {
        out.issues.push({ source: 'fixtures', code: 'http-error', severity: 'error', message: 'Simulated: the data server is down.', retryable: true, httpStatus: 503 });
        return out;
      }

      const identity: AdapterItem = {
        kind: 'identity',
        source: 'fixtures',
        fetchedAt,
        did: ds.did,
        didMethod: 'plc',
        handle: ds.handle,
        handleVerified: true,
        pdsUrl: FIXTURE_PDS,
        createdAt: FIXTURE_CREATED_AT,
        handleHistory: [
          { handle: FIXTURE_OLD_HANDLE, firstSeenAt: FIXTURE_CREATED_AT },
          { handle: ds.handle, firstSeenAt: FIXTURE_HANDLE_CHANGED_AT },
        ],
      };
      out.items.push(identity);

      const cap = Math.max(1, Math.floor(req.options?.maxRecordsPerCollection ?? 1000));
      for (const [collection, recs] of Object.entries(ds.collections)) {
        if (wanted ? !wanted.has(collection) : recs.length === 0) continue;
        const ordered = req.options?.order === 'oldest-first' ? recs : [...recs].reverse();
        const slice = ordered.slice(0, cap);
        for (const r of slice) {
          out.items.push({
            kind: 'record',
            source: 'fixtures',
            fetchedAt,
            collection,
            rkey: r.uri.slice(r.uri.lastIndexOf('/') + 1),
            uri: r.uri,
            cid: r.cid,
            value: r.value,
          });
        }
        const complete = slice.length === recs.length;
        out.coverage.push({ source: 'fixtures', collection, fetched: slice.length, complete, ...(complete ? {} : { reason: 'record-cap' as const }) });
      }

      if (scenario === 'appview-down' || scenario === 'rate-limited') {
        out.issues.push({
          source: 'fixtures',
          code: scenario === 'rate-limited' ? 'rate-limited' : 'http-error',
          severity: 'error',
          message: 'Simulated: public counts are unavailable.',
          retryable: true,
        });
        out.coverage.push({ source: 'fixtures', collection: 'engagement', fetched: 0, complete: false, reason: 'error' });
        return out;
      }

      out.items.push({
        kind: 'profile-stats',
        source: 'fixtures',
        fetchedAt,
        did: ds.did,
        handle: ds.handle,
        displayName: ds.profile.displayName,
        followersCount: ds.profile.followersCount,
        followsCount: ds.profile.followsCount,
        postsCount: ds.profile.postsCount,
        createdAt: ds.profile.createdAt,
      });
      if (req.options?.includeEngagement !== false) {
        const allPosts = ds.collections['app.bsky.feed.post'] ?? [];
        const posts = (req.options?.order === 'oldest-first' ? allPosts : [...allPosts].reverse()).slice(0, cap);
        for (const p of posts) {
          const c = ds.postCounts[p.uri]!;
          out.items.push({ kind: 'engagement', source: 'fixtures', fetchedAt, uri: p.uri, cid: p.cid, ...c, indexedAt: p.value.createdAt as string });
        }
        out.coverage.push({ source: 'fixtures', collection: 'engagement', fetched: posts.length, complete: true });
      }
      return out;
    },
  };
}

export { createFixtureFetch, type FixtureFetch } from './fetch';
export {
  buildDataset,
  FIXTURE_SCENARIOS,
  FIXTURE_DID,
  FIXTURE_HANDLE,
  FIXTURE_PDS,
  type FixtureScenario,
  type FixtureDataset,
} from './data';
