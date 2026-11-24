import { describe, expect, it } from 'vitest';
import type { AdapterItem, AdapterResult, EngagementItem, RecordItem } from '../adapters/contract';
import { normalize } from './index';

const did = 'did:plc:fixtureaaaaaaaaaaaaaaaaa';
const collection = 'app.bsky.feed.post';
const fetchedAt = '2026-01-05T12:00:00Z';

function post(rkey: string, value: unknown): RecordItem {
  return {
    kind: 'record', source: 'atproto', fetchedAt, collection, rkey,
    uri: `at://${did}/${collection}/${rkey}`, cid: `bafyfixture${rkey}`, value,
  };
}

const first = post('3abc', { createdAt: '2026-01-03T09:15:00Z' });
const parent = { uri: first.uri, cid: first.cid };
const second = post('3def', { createdAt: '2026-01-04T16:40:00Z', reply: { root: parent, parent } });
const counts: EngagementItem = {
  kind: 'engagement', source: 'bluesky', fetchedAt, uri: first.uri, cid: first.cid,
  likeCount: 8, replyCount: 0, repostCount: 2, quoteCount: 1, indexedAt: null,
};

function input(items: AdapterItem[], coverage: AdapterResult['coverage']): AdapterResult {
  return {
    schemaVersion: 1, subject: { did, handle: null, pdsUrl: null }, fetchedAt,
    items, issues: [], coverage, adapters: ['atproto', 'bluesky'],
    complete: coverage.every(entry => entry.complete),
  };
}

describe('normalize', () => {
  it.each([
    { order: 'before', items: [counts, first, second] },
    { order: 'after', items: [first, second, counts] },
  ])('joins counts by URI when engagement arrives $order the posts', ({ items }) => {
    const coverage: AdapterResult['coverage'] = [
      { source: 'atproto', collection, fetched: 2, complete: true },
      { source: 'bluesky', collection: 'engagement', fetched: 1, complete: false, reason: 'not-indexed' },
    ];
    expect(normalize(input(items, coverage))).toEqual({
      fetchedAt, coverage,
      posts: [
        {
          uri: first.uri, createdAt: '2026-01-03T09:15:00Z', isReply: false,
          engagement: { likeCount: 8, replyCount: 0, repostCount: 2, quoteCount: 1 },
        },
        { uri: second.uri, createdAt: '2026-01-04T16:40:00Z', isReply: true, engagement: null },
      ],
    });
  });

  it('keeps an unknown quote count alongside measured counts', () => {
    const result = normalize(input([first, { ...counts, quoteCount: null }], []));
    expect(result.posts[0]?.engagement).toEqual({ likeCount: 8, replyCount: 0, repostCount: 2, quoteCount: null });
  });

  it('keeps posts when their metadata is unreadable', () => {
    const items = [
      post('bad-body', null),
      post('bad-fields', { createdAt: 'yesterday', reply: [] }),
      post('local-time', { createdAt: '2026-01-03T09:15:00' }),
      post('offset', { createdAt: '2026-01-03T10:15:00+01:00' }),
    ];
    const { posts } = normalize(input(items, []));
    expect(posts.map(({ createdAt, isReply }) => [createdAt, isReply])).toEqual([
      [null, null], [null, null], [null, false], ['2026-01-03T10:15:00+01:00', false],
    ]);
  });

  it('preserves an empty collection and its coverage', () => {
    const coverage: AdapterResult['coverage'] = [{ source: 'atproto', collection, fetched: 0, complete: true }];
    expect(normalize(input([], coverage))).toEqual({ fetchedAt, posts: [], coverage });
  });

  it('only creates posts from post records, even when fallback engagement exists', () => {
    const otherCollection = 'app.bsky.feed.like';
    const like: RecordItem = {
      ...first, collection: otherCollection, uri: `at://${did}/${otherCollection}/3abc`,
    };
    const coverage: AdapterResult['coverage'] = [
      { source: 'atproto', collection, fetched: 0, complete: false, reason: 'error' },
      { source: 'bluesky', collection: 'engagement', fetched: 1, complete: true },
    ];
    expect(normalize(input([like, counts], coverage))).toEqual({ fetchedAt, posts: [], coverage });
  });
});
