import { describe, expect, it, vi } from 'vitest';
import { createContext } from '../context';
import type { AdapterContext, IdentityItem, RecordItem } from '../contract';
import { FIXTURE_DID, FIXTURE_HANDLE, FIXTURE_PDS, createFixtureFetch } from '../fixtures';
import { createAtprotoAdapter } from './index';
import { resolveIdentity } from './identity';
import { readRepo } from './repo';

const mk = (f: typeof fetch, extra: Partial<AdapterContext> = {}) =>
  createContext({ fetch: f, sleep: async () => {}, now: () => new Date('2026-01-01T00:00:00Z'), ...extra });

describe('resolveIdentity', () => {
  it('builds the identity card from a DID', async () => {
    const fx = createFixtureFetch();
    const r = await resolveIdentity(mk(fx.fetch), { subject: { did: FIXTURE_DID } });
    const id = r.item as IdentityItem;
    expect(r.issues).toEqual([]);
    expect(id).toMatchObject({
      did: FIXTURE_DID,
      didMethod: 'plc',
      handle: FIXTURE_HANDLE,
      handleVerified: true,
      pdsUrl: FIXTURE_PDS,
      createdAt: '2025-03-01T12:00:00.000Z',
    });
    expect(id.handleHistory?.map((h) => h.handle)).toEqual(['alice-old.fixture.test', FIXTURE_HANDLE]);
  });

  it('resolves a handle to a DID first', async () => {
    const fx = createFixtureFetch();
    const r = await resolveIdentity(mk(fx.fetch), { subject: { handle: FIXTURE_HANDLE } });
    expect(r.did).toBe(FIXTURE_DID);
  });

  it('rejects malformed DIDs and handles without touching the network', async () => {
    const f = vi.fn();
    const ctx = mk(f as unknown as typeof fetch);
    expect((await resolveIdentity(ctx, { subject: { did: 'did:key:z6Mk' } })).issues[0]?.code).toBe('invalid-did');
    expect((await resolveIdentity(ctx, { subject: { handle: 'not a handle' } })).issues[0]?.code).toBe('invalid-request');
    expect((await resolveIdentity(ctx, { subject: {} })).issues[0]?.code).toBe('invalid-request');
    expect(f).not.toHaveBeenCalled();
  });

  it('reports not-found for an unregistered DID', async () => {
    const fx = createFixtureFetch();
    const r = await resolveIdentity(mk(fx.fetch), { subject: { did: 'did:plc:zzzzzzzzzzzzzzzzzzzzzzzz' } });
    expect(r.issues.some((i) => i.code === 'not-found')).toBe(true);
    expect(r.item?.pdsUrl ?? null).toBeNull();
  });

  it('refuses an unsafe PDS address from a DID document', async () => {
    const f = (async (u: string) => {
      const url = String(u);
      if (url.includes('/log/audit')) return new Response('[]', { status: 200 });
      return new Response(
        JSON.stringify({
          id: FIXTURE_DID,
          alsoKnownAs: [],
          service: [{ id: '#atproto_pds', type: 'x', serviceEndpoint: 'http://169.254.169.254' }],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const r = await resolveIdentity(mk(f), { subject: { did: FIXTURE_DID } });
    expect(r.item?.pdsUrl).toBeNull();
    expect(r.issues.some((i) => i.code === 'unsafe-url')).toBe(true);
  });

  it('flags a DID document whose id does not match', async () => {
    const f = (async () => new Response(JSON.stringify({ id: 'did:plc:other' }), { status: 200 })) as unknown as typeof fetch;
    const r = await resolveIdentity(mk(f), { subject: { did: FIXTURE_DID } });
    expect(r.issues.some((i) => i.code === 'bad-response')).toBe(true);
  });

  it('uses the caller PDS hint only when the DID doc is unreachable, and says so', async () => {
    const f = (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch;
    const r = await resolveIdentity(mk(f), { subject: { did: FIXTURE_DID, pdsUrl: FIXTURE_PDS } });
    expect(r.item?.pdsUrl).toBe(FIXTURE_PDS);
    expect(r.issues.map((i) => i.code)).toContain('pds-unverified');
  });

  it('flags handle mismatch and skips PLC history when disabled', async () => {
    const fx = createFixtureFetch();
    const r = await resolveIdentity(mk(fx.fetch), {
      subject: { did: FIXTURE_DID, handle: 'someone-else.fixture.test' },
      options: { includeIdentityHistory: false },
    });
    expect(r.issues.map((i) => i.code)).toContain('handle-mismatch');
    expect(r.item?.createdAt).toBeNull();
    expect(fx.calls.some((c) => c.includes('/log/audit'))).toBe(false);
  });

  it('supports did:web, with creation date unavailable', async () => {
    const doc = {
      id: 'did:web:alice.example.com',
      alsoKnownAs: ['at://alice.example.com'],
      service: [{ id: '#atproto_pds', type: 'x', serviceEndpoint: 'https://pds.example.com' }],
    };
    const f = (async (u: string) => {
      const url = String(u);
      if (url === 'https://alice.example.com/.well-known/did.json') return new Response(JSON.stringify(doc), { status: 200 });
      if (url.includes('resolveHandle')) return new Response(JSON.stringify({ did: 'did:web:alice.example.com' }), { status: 200 });
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const r = await resolveIdentity(mk(f), { subject: { did: 'did:web:alice.example.com' } });
    expect(r.item).toMatchObject({ didMethod: 'web', pdsUrl: 'https://pds.example.com', createdAt: null, handleHistory: null, handleVerified: true });
    expect(r.issues.map((i) => i.code)).toEqual(['unsupported-did-method']);
  });

  it('skips nullified PLC operations when building handle history', async () => {
    const f = (async (u: string) => {
      const url = String(u);
      if (url.endsWith('/log/audit')) {
        return new Response(
          JSON.stringify([
            { nullified: false, createdAt: '2025-01-01T00:00:00Z', operation: { alsoKnownAs: ['at://first.test'] } },
            { nullified: true, createdAt: '2025-02-01T00:00:00Z', operation: { alsoKnownAs: ['at://hijack.test'] } },
          ]),
          { status: 200 },
        );
      }
      return fetchDoc();
    }) as unknown as typeof fetch;
    const fx = createFixtureFetch();
    const fetchDoc = () => fx.fetch(`https://plc.directory/${FIXTURE_DID}`);
    const r = await resolveIdentity(mk(f), { subject: { did: FIXTURE_DID } });
    expect(r.item?.handleHistory?.map((h) => h.handle)).toEqual(['first.test']);
  });
});

describe('readRepo', () => {
  const run = (fx = createFixtureFetch(), req = {}) =>
    readRepo(mk(fx.fetch), { subject: { did: FIXTURE_DID }, ...req }, FIXTURE_PDS, FIXTURE_DID);

  it('discovers collections and reads every record with paging', async () => {
    const fx = createFixtureFetch();
    const r = await run(fx);
    const posts = r.items.filter((i) => i.collection === 'app.bsky.feed.post');
    expect(posts).toHaveLength(60);
    expect(r.coverage.every((c) => c.complete)).toBe(true);
    expect(r.issues).toEqual([]);
    expect(fx.calls.filter((c) => c.includes('describeRepo'))).toHaveLength(1);
  });

  it('follows cursors across several 100-record pages', async () => {
    const total = 250;
    const calls: string[] = [];
    const f = (async (u: string) => {
      const url = new URL(String(u));
      calls.push(url.search);
      const limit = Number(url.searchParams.get('limit'));
      const start = Number(url.searchParams.get('cursor') ?? 0);
      const n = Math.min(limit, total - start);
      const records = Array.from({ length: n }, (_, i) => ({ uri: `at://${FIXTURE_DID}/app.bsky.feed.like/k${start + i}`, cid: 'c', value: {} }));
      const body = start + n < total ? { records, cursor: String(start + n) } : { records };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await readRepo(mk(f), { subject: { did: FIXTURE_DID }, collections: ['app.bsky.feed.like'], options: { maxRecordsPerCollection: 1000 } }, FIXTURE_PDS, FIXTURE_DID);
    expect(r.items).toHaveLength(250);
    expect(new Set(r.items.map((i) => i.uri)).size).toBe(250);
    expect(calls).toHaveLength(3);
    expect(r.coverage[0]).toMatchObject({ fetched: 250, complete: true });
  });

  it('stops at the record cap and reports it as partial', async () => {
    const fx = createFixtureFetch();
    const r = await run(fx, { collections: ['app.bsky.feed.post'], options: { maxRecordsPerCollection: 25 } });
    expect(r.items).toHaveLength(25);
    expect(r.coverage[0]).toMatchObject({ collection: 'app.bsky.feed.post', fetched: 25, complete: false, reason: 'record-cap' });
  });

  it('keeps the NEWEST records when truncating (default), oldest on request', async () => {
    const newest = await run(createFixtureFetch(), { collections: ['app.bsky.feed.post'], options: { maxRecordsPerCollection: 3 } });
    const oldest = await run(createFixtureFetch(), { collections: ['app.bsky.feed.post'], options: { maxRecordsPerCollection: 3, order: 'oldest-first' } });
    const created = (r: typeof newest) => r.items.map((i) => (i.value as { createdAt: string }).createdAt);
    expect(Math.min(...created(newest).map(Date.parse))).toBeGreaterThan(Math.max(...created(oldest).map(Date.parse)));
  });

  it('reads only registry-requested collections and skips describeRepo', async () => {
    const fx = createFixtureFetch();
    const r = await run(fx, { collections: ['app.bsky.graph.block', 'app.bsky.graph.block', 'site.standard.document'] });
    expect(r.items.map((i) => i.collection).sort()).toEqual(['app.bsky.graph.block', 'app.bsky.graph.block', 'site.standard.document']);
    expect(fx.calls.some((c) => c.includes('describeRepo'))).toBe(false);
  });

  it('treats a requested-but-absent collection as empty and complete', async () => {
    const r = await run(createFixtureFetch(), { collections: ['com.example.nothing'] });
    expect(r.items).toEqual([]);
    expect(r.coverage).toEqual([{ source: 'atproto', collection: 'com.example.nothing', fetched: 0, complete: true }]);
  });

  it('keeps raw values untouched and fills provenance', async () => {
    const r = await run(createFixtureFetch(), { collections: ['app.bsky.graph.block'] });
    const rec = r.items[0] as RecordItem;
    expect(rec).toMatchObject({ kind: 'record', source: 'atproto', collection: 'app.bsky.graph.block', fetchedAt: '2026-01-01T00:00:00.000Z' });
    expect(rec.uri).toBe(`at://${FIXTURE_DID}/app.bsky.graph.block/${rec.rkey}`);
    expect(rec.value).toMatchObject({ $type: 'app.bsky.graph.block' });
  });

  it('drops records that are not this account\'s own, and says so', async () => {
    const bad = (async (u: string) => {
      const url = String(u);
      if (url.includes('listRecords')) {
        return new Response(
          JSON.stringify({
            records: [
              { uri: `at://${FIXTURE_DID}/app.bsky.feed.like/a`, cid: 'c1', value: { x: 1 } },
              { uri: 'at://did:plc:evilaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.like/b', cid: 'c2', value: {} },
              { uri: `at://${FIXTURE_DID}/app.bsky.feed.post/c`, cid: 'c3', value: {} },
              { uri: 'garbage', cid: 'c4', value: {} },
              { uri: `at://${FIXTURE_DID}/app.bsky.feed.like/d`, value: {} },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const r = await readRepo(mk(bad), { subject: { did: FIXTURE_DID }, collections: ['app.bsky.feed.like'] }, FIXTURE_PDS, FIXTURE_DID);
    expect(r.items).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: 'bad-response', collection: 'app.bsky.feed.like' });
    expect(r.issues[0]!.message).toContain('4 malformed');
  });

  it('stops on a repeated cursor instead of looping forever', async () => {
    let n = 0;
    const loop = (async () => {
      n++;
      return new Response(
        JSON.stringify({ cursor: 'same', records: [{ uri: `at://${FIXTURE_DID}/app.bsky.feed.like/k${n}`, cid: 'c', value: {} }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const r = await readRepo(mk(loop), { subject: { did: FIXTURE_DID }, collections: ['app.bsky.feed.like'] }, FIXTURE_PDS, FIXTURE_DID);
    expect(n).toBeLessThanOrEqual(3);
    expect(r.coverage[0]).toMatchObject({ complete: false, reason: 'error' });
  });

  it('keeps records from collections that worked when another fails', async () => {
    const f = (async (u: string) => {
      const url = String(u);
      if (url.includes('collection=app.bsky.graph.block')) return new Response('{}', { status: 400 });
      return createFixtureFetch().fetch(url);
    }) as unknown as typeof fetch;
    const r = await readRepo(
      mk(f),
      { subject: { did: FIXTURE_DID }, collections: ['app.bsky.graph.block', 'app.bsky.graph.follow'] },
      FIXTURE_PDS,
      FIXTURE_DID,
    );
    expect(r.items.filter((i) => i.collection === 'app.bsky.graph.follow')).toHaveLength(25);
    expect(r.coverage.find((c) => c.collection === 'app.bsky.graph.block')).toMatchObject({ complete: false, reason: 'error', fetched: 0 });
    expect(r.issues.some((i) => i.collection === 'app.bsky.graph.block')).toBe(true);
  });

  it('reports a describeRepo failure as one error with no items', async () => {
    const r = await run(createFixtureFetch('pds-down'));
    expect(r.items).toEqual([]);
    expect(r.issues.some((i) => i.severity === 'error')).toBe(true);
    expect(r.coverage[0]).toMatchObject({ complete: false, reason: 'error' });
  });

  describe('session handling (self-only)', () => {
    it('uses the session fetch only for the matching DID', async () => {
      const fx = createFixtureFetch();
      const sessionFetch = vi.fn(fx.fetch);
      await readRepo(mk(fx.fetch), { subject: { did: FIXTURE_DID }, collections: ['app.bsky.graph.block'], session: { did: FIXTURE_DID, fetch: sessionFetch } }, FIXTURE_PDS, FIXTURE_DID);
      expect(sessionFetch).toHaveBeenCalled();
    });

    it('never sends another account\'s credentials, and warns', async () => {
      const fx = createFixtureFetch();
      const seen: Array<HeadersInit | undefined> = [];
      const spy = (async (u: RequestInfo | URL, init?: RequestInit) => {
        seen.push(init?.headers);
        return fx.fetch(u, init);
      }) as typeof fetch;
      const r = await readRepo(
        mk(spy),
        { subject: { did: FIXTURE_DID }, collections: ['app.bsky.graph.block'], session: { did: 'did:plc:someoneelseaaaaaaaaaaaa', accessToken: 'SECRET' } },
        FIXTURE_PDS,
        FIXTURE_DID,
      );
      expect(JSON.stringify(seen)).not.toContain('SECRET');
      expect(r.issues.map((i) => i.code)).toContain('session-mismatch');
      expect(JSON.stringify(r)).not.toContain('SECRET');
    });

    it('sends a bearer token for the matching DID', async () => {
      const fx = createFixtureFetch();
      const seen: string[] = [];
      const spy = (async (u: RequestInfo | URL, init?: RequestInit) => {
        seen.push(JSON.stringify(init?.headers));
        return fx.fetch(u, init);
      }) as typeof fetch;
      await readRepo(mk(spy), { subject: { did: FIXTURE_DID }, collections: ['app.bsky.graph.block'], session: { did: FIXTURE_DID, accessToken: 'T0K' } }, FIXTURE_PDS, FIXTURE_DID);
      expect(seen.join()).toContain('Bearer T0K');
    });
  });
});

describe('atproto adapter', () => {
  it('returns identity + records + coverage', async () => {
    const fx = createFixtureFetch();
    const out = await createAtprotoAdapter().run(mk(fx.fetch), { subject: { handle: FIXTURE_HANDLE } }, []);
    expect(out.items[0]?.kind).toBe('identity');
    expect(out.items.filter((i) => i.kind === 'record').length).toBe(60 + 40 + 8 + 25 + 2 + 1 + 1);
    expect(out.items.every((i) => i.source === 'atproto')).toBe(true);
  });

  it('stops after identity if no PDS is known', async () => {
    const f = (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch;
    const out = await createAtprotoAdapter().run(mk(f), { subject: { did: FIXTURE_DID } }, []);
    expect(out.items.filter((i) => i.kind === 'record')).toEqual([]);
    expect(out.issues.some((i) => i.severity === 'error')).toBe(true);
  });
});
