import { describe, expect, it } from 'vitest';
import { createContext } from '../context';
import type { AdapterContext, AdapterItem, EngagementItem, RecordItem } from '../contract';
import { FIXTURE_DID, createFixtureFetch } from '../fixtures';
import { createBlueskyAdapter, toEngagement } from './index';

const mk = (f: typeof fetch, extra: Partial<AdapterContext> = {}) =>
  createContext({ fetch: f, sleep: async () => {}, now: () => new Date('2026-01-01T00:00:00Z'), ...extra });

const postRecords = (fx = createFixtureFetch()): RecordItem[] =>
  fx.dataset.collections['app.bsky.feed.post']!.map((r) => ({
    kind: 'record', source: 'atproto', fetchedAt: 'x', collection: 'app.bsky.feed.post',
    rkey: r.uri.split('/').pop()!, uri: r.uri, cid: r.cid, value: r.value,
  }));

const eng = (items: AdapterItem[]) => items.filter((i): i is EngagementItem => i.kind === 'engagement');

describe('toEngagement', () => {
  it('treats missing like/repost/reply counts as 0 but missing quoteCount as null', () => {
    expect(toEngagement({ uri: 'at://a/b/c', cid: 'x' }, 't')).toMatchObject({ likeCount: 0, repostCount: 0, replyCount: 0, quoteCount: null });
  });
  it('rejects posts without uri/cid and non-objects', () => {
    expect(toEngagement({ uri: 'u' }, 't')).toBeNull();
    expect(toEngagement(null, 't')).toBeNull();
    expect(toEngagement('x', 't')).toBeNull();
  });
  it('ignores negative or non-numeric counts', () => {
    expect(toEngagement({ uri: 'u', cid: 'c', likeCount: -5, replyCount: '3' }, 't')).toMatchObject({ likeCount: 0, replyCount: 0 });
  });
});

describe('bluesky adapter', () => {
  it('with upstream records: batches getPosts by 25 and matches counts exactly', async () => {
    const fx = createFixtureFetch();
    const out = await createBlueskyAdapter().run(mk(fx.fetch), { subject: { did: FIXTURE_DID } }, postRecords(fx));
    const batches = fx.calls.filter((c) => c.includes('getPosts'));
    expect(batches).toHaveLength(3); // 60 posts / 25
    for (const c of batches) expect(new URL(c).searchParams.getAll('uris').length).toBeLessThanOrEqual(25);
    expect(eng(out.items)).toHaveLength(60);
    for (const e of eng(out.items)) expect(e).toMatchObject(fx.dataset.postCounts[e.uri]!);
    expect(out.coverage).toEqual([{ source: 'bluesky', collection: 'engagement', fetched: 60, complete: true }]);
    expect(out.items.find((i) => i.kind === 'profile-stats')).toMatchObject({ followersCount: 123, postsCount: 60 });
  });

  it('never calls the author feed when upstream records exist', async () => {
    const fx = createFixtureFetch();
    await createBlueskyAdapter().run(mk(fx.fetch), { subject: { did: FIXTURE_DID } }, postRecords(fx));
    expect(fx.calls.some((c) => c.includes('getAuthorFeed'))).toBe(false);
  });

  it('flags posts the AppView does not know (deleted / not indexed) as incomplete, not an error', async () => {
    const fx = createFixtureFetch();
    const ups = postRecords(fx);
    ups.push({ ...ups[0]!, uri: `at://${FIXTURE_DID}/app.bsky.feed.post/ghost`, cid: 'g' });
    const out = await createBlueskyAdapter().run(mk(fx.fetch), { subject: { did: FIXTURE_DID } }, ups);
    expect(out.coverage[0]).toMatchObject({ fetched: 60, complete: false, reason: 'not-indexed' });
    expect(out.issues).toEqual([expect.objectContaining({ code: 'not-indexed', severity: 'info' })]);
  });

  it('without upstream: falls back to the author feed and pages through it', async () => {
    const fx = createFixtureFetch();
    const out = await createBlueskyAdapter().run(mk(fx.fetch), { subject: { handle: 'alice.fixture.test' } }, []);
    expect(eng(out.items)).toHaveLength(60);
    expect(out.coverage[0]).toMatchObject({ complete: true, fetched: 60 });
    expect(fx.calls.some((c) => c.includes('getAuthorFeed'))).toBe(true);
  });

  it('feed fallback honours the post cap and says it is partial', async () => {
    const fx = createFixtureFetch();
    const out = await createBlueskyAdapter().run(mk(fx.fetch), { subject: { did: FIXTURE_DID }, options: { maxRecordsPerCollection: 10 } }, []);
    expect(eng(out.items)).toHaveLength(10);
    expect(out.coverage[0]).toMatchObject({ complete: false, reason: 'record-cap' });
  });

  it('feed fallback excludes reposts and other authors\' posts', async () => {
    const mine = { uri: `at://${FIXTURE_DID}/app.bsky.feed.post/a`, cid: 'c1', author: { did: FIXTURE_DID }, likeCount: 1 };
    const theirs = { uri: 'at://did:plc:other/app.bsky.feed.post/b', cid: 'c2', author: { did: 'did:plc:other' }, likeCount: 99 };
    const f = (async (u: string) => {
      if (String(u).includes('getAuthorFeed')) {
        return new Response(JSON.stringify({ feed: [{ post: mine }, { post: theirs, reason: { $type: 'repost' } }, { post: { ...theirs, uri: 'at://x/y/z' } }] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;
    const out = await createBlueskyAdapter().run(mk(f), { subject: { did: FIXTURE_DID } }, []);
    expect(eng(out.items).map((e) => e.uri)).toEqual([mine.uri]);
  });

  it('upstream with zero posts: no engagement calls, complete', async () => {
    const fx = createFixtureFetch('empty');
    const ups: AdapterItem[] = [{ kind: 'record', source: 'atproto', fetchedAt: 'x', collection: 'app.bsky.graph.block', rkey: 'k', uri: `at://${FIXTURE_DID}/app.bsky.graph.block/k`, cid: 'c', value: {} }];
    const out = await createBlueskyAdapter().run(mk(fx.fetch), { subject: { did: FIXTURE_DID } }, ups);
    expect(eng(out.items)).toEqual([]);
    expect(out.coverage[0]).toMatchObject({ fetched: 0, complete: true });
    expect(fx.calls.some((c) => c.includes('getPosts'))).toBe(false);
  });

  it('includeEngagement:false returns only the profile counters', async () => {
    const fx = createFixtureFetch();
    const out = await createBlueskyAdapter().run(mk(fx.fetch), { subject: { did: FIXTURE_DID }, options: { includeEngagement: false } }, postRecords(fx));
    expect(out.items.map((i) => i.kind)).toEqual(['profile-stats']);
  });

  it('AppView down: degrades to issues + incomplete coverage, never throws', async () => {
    const fx = createFixtureFetch('appview-down');
    const out = await createBlueskyAdapter().run(mk(fx.fetch, { maxRetries: 1 }), { subject: { did: FIXTURE_DID } }, postRecords(fx));
    expect(eng(out.items)).toEqual([]);
    expect(out.issues.some((i) => i.severity === 'error' && i.retryable)).toBe(true);
    expect(out.coverage[0]).toMatchObject({ complete: false, reason: 'error', fetched: 0 });
  });

  it('rate limited with a long Retry-After: reports rate-limited without waiting', async () => {
    const fx = createFixtureFetch('rate-limited');
    const out = await createBlueskyAdapter().run(mk(fx.fetch), { subject: { did: FIXTURE_DID } }, postRecords(fx));
    expect(out.issues.some((i) => i.code === 'rate-limited')).toBe(true);
  });

  it('a partially failing batch keeps the batches that worked', async () => {
    const fx = createFixtureFetch();
    let n = 0;
    const f = (async (u: RequestInfo | URL, init?: RequestInit) => {
      if (String(u).includes('getPosts') && ++n === 2) return new Response('{}', { status: 400 });
      return fx.fetch(u, init);
    }) as typeof fetch;
    const out = await createBlueskyAdapter().run(mk(f), { subject: { did: FIXTURE_DID } }, postRecords(fx));
    expect(eng(out.items).length).toBe(35); // 60 - one failed batch of 25
    expect(out.coverage[0]).toMatchObject({ complete: false, reason: 'error', fetched: 35 });
  });

  it('never sends session credentials to the AppView', async () => {
    const fx = createFixtureFetch();
    const headers: string[] = [];
    const spy = (async (u: RequestInfo | URL, init?: RequestInit) => {
      headers.push(JSON.stringify(init?.headers));
      return fx.fetch(u, init);
    }) as typeof fetch;
    await createBlueskyAdapter().run(mk(spy), { subject: { did: FIXTURE_DID }, session: { did: FIXTURE_DID, accessToken: 'SECRET' } }, postRecords(fx));
    expect(headers.join()).not.toContain('SECRET');
  });

  it('needs a subject', async () => {
    const out = await createBlueskyAdapter().run(mk(createFixtureFetch().fetch), { subject: {} }, []);
    expect(out.issues[0]).toMatchObject({ code: 'invalid-request' });
  });
});
