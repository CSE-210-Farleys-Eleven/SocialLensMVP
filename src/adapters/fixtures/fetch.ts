import {
  FIXTURE_CREATED_AT,
  FIXTURE_HANDLE,
  FIXTURE_HANDLE_CHANGED_AT,
  FIXTURE_OLD_HANDLE,
  FIXTURE_PDS,
  buildDataset,
  type FixtureDataset,
  type FixtureScenario,
} from './data';

export interface FixtureFetch {
  fetch: typeof fetch;
  /** Every URL requested, in order. */
  calls: string[];
  dataset: FixtureDataset;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const xrpcError = (status: number, error: string, message = error) => json({ error, message }, status);

/**
 * A fake `fetch` that speaks the same HTTP/JSON as plc.directory, a PDS and
 * the Bluesky AppView, serving the synthetic dataset. Lets the live adapters
 * run their real code paths with no network.
 */
export function createFixtureFetch(scenario: FixtureScenario = 'typical'): FixtureFetch {
  const dataset = buildDataset(scenario);
  const calls: string[] = [];
  const { did, handle } = dataset;

  const didDoc = {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: did,
    alsoKnownAs: [`at://${handle}`],
    service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: FIXTURE_PDS }],
  };
  const audit = [
    {
      did,
      operation: { type: 'plc_operation', alsoKnownAs: [`at://${FIXTURE_OLD_HANDLE}`] },
      cid: 'bafyfixtureop1',
      nullified: false,
      createdAt: FIXTURE_CREATED_AT,
    },
    {
      did,
      operation: { type: 'plc_operation', alsoKnownAs: [`at://${FIXTURE_HANDLE}`] },
      cid: 'bafyfixtureop2',
      nullified: false,
      createdAt: FIXTURE_HANDLE_CHANGED_AT,
    },
  ];

  const allPosts = dataset.collections['app.bsky.feed.post'] ?? [];
  const postView = (r: (typeof allPosts)[number]) => ({
    uri: r.uri,
    cid: r.cid,
    author: { did, handle },
    record: r.value,
    indexedAt: (r.value.createdAt as string) ?? null,
    ...(dataset.postCounts[r.uri] ?? { likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: 0 }),
  });

  const impl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    const q = url.searchParams;

    if (url.host === 'plc.directory') {
      if (url.pathname === `/${did}`) return json(didDoc);
      if (url.pathname === `/${did}/log/audit`) return json(audit);
      return json({ message: 'DID not registered' }, 404);
    }

    if (url.host === 'public.api.bsky.app') {
      if (scenario === 'appview-down') return xrpcError(503, 'ServiceUnavailable');
      if (scenario === 'rate-limited') {
        // Resolution is cheap and still answered; counts are throttled.
        if (!url.pathname.endsWith('resolveHandle')) return json({ error: 'RateLimitExceeded' }, 429, { 'retry-after': '3600' });
      }
      switch (url.pathname) {
        case '/xrpc/com.atproto.identity.resolveHandle':
          return q.get('handle') === handle
            ? json({ did })
            : xrpcError(400, 'InvalidRequest', 'Unable to resolve handle');
        case '/xrpc/app.bsky.actor.getProfile':
          if (q.get('actor') !== did && q.get('actor') !== handle) return xrpcError(400, 'InvalidRequest', 'Profile not found');
          return json({ did, handle, ...dataset.profile });
        case '/xrpc/app.bsky.feed.getPosts': {
          const wanted = q.getAll('uris');
          if (wanted.length > 25) return xrpcError(400, 'InvalidRequest', 'Too many uris');
          const set = new Set(wanted);
          return json({ posts: allPosts.filter((p) => set.has(p.uri)).map(postView) });
        }
        case '/xrpc/app.bsky.feed.getAuthorFeed': {
          if (q.get('actor') !== did && q.get('actor') !== handle) return xrpcError(400, 'InvalidRequest', 'Profile not found');
          const limit = Math.min(Number(q.get('limit') ?? 50), 100);
          const start = Number(q.get('cursor') ?? 0);
          // Newest first, like the real feed.
          const ordered = [...allPosts].reverse();
          const slice = ordered.slice(start, start + limit);
          const next = start + limit < ordered.length ? String(start + limit) : undefined;
          return json({ feed: slice.map((p) => ({ post: postView(p) })), ...(next ? { cursor: next } : {}) });
        }
      }
      return xrpcError(404, 'MethodNotImplemented');
    }

    if (url.origin === FIXTURE_PDS) {
      if (scenario === 'pds-down') return xrpcError(503, 'ServiceUnavailable');
      if (q.get('repo') !== did) return xrpcError(400, 'RepoNotFound', 'Could not find repo');
      if (url.pathname === '/xrpc/com.atproto.repo.describeRepo') {
        return json({
          handle,
          did,
          didDoc,
          handleIsCorrect: true,
          collections: Object.entries(dataset.collections)
            .filter(([, recs]) => recs.length > 0)
            .map(([c]) => c),
        });
      }
      if (url.pathname === '/xrpc/com.atproto.repo.listRecords') {
        const col = q.get('collection') ?? '';
        const stored = dataset.collections[col];
        if (!stored) return json({ records: [] });
        const recs = q.get('reverse') === 'true' ? [...stored].reverse() : stored;
        const limit = Math.min(Number(q.get('limit') ?? 50), 100);
        const start = Number(q.get('cursor') ?? 0);
        const slice = recs.slice(start, start + limit);
        const next = start + limit < recs.length ? String(start + limit) : undefined;
        return json({ records: slice, ...(next ? { cursor: next } : {}) });
      }
      return xrpcError(404, 'MethodNotImplemented');
    }

    // Unknown host: behave like a DNS failure.
    throw new TypeError(`fixture fetch: no route for ${url.host}`);
  };

  return { fetch: impl as typeof fetch, calls, dataset };
}
