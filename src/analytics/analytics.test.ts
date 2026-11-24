import { describe, expect, it } from 'vitest';
import type { AnalyticsInput } from './contract';
import { analyze } from './index';

const fetchedAt = '2026-01-05T12:00:00Z';
const postCollection = 'app.bsky.feed.post';
const unknownMetric = { status: 'unknown', total: null, average: null, measuredPosts: 0 };

function snapshot(posts: AnalyticsInput['posts'], coverage: AnalyticsInput['coverage']): AnalyticsInput {
  return { fetchedAt, posts, coverage };
}

function fixtureCoverage(collection: string, fetched: number, complete: boolean): AnalyticsInput['coverage'][number] {
  return { source: 'fixtures', collection, fetched, complete };
}

describe('analyze', () => {
  it('sorts UTC publication days and averages each metric across its own measured posts', () => {
    const postCoverage = fixtureCoverage(postCollection, 4, true);
    const engagementCoverage = {
      ...fixtureCoverage('engagement', 3, false), reason: 'not-indexed' as const,
    };
    const input = snapshot([
      {
        createdAt: '2026-01-04T03:15:00Z', isReply: false,
        engagement: { likeCount: 9, replyCount: 3, repostCount: 1, quoteCount: 2 },
      },
      {
        createdAt: '2026-01-04T00:30:00+02:00', isReply: true,
        engagement: { likeCount: 0, replyCount: 0, repostCount: 0, quoteCount: null },
      },
      { createdAt: '2026-01-03T18:00:00Z', isReply: false, engagement: null },
      {
        createdAt: null, isReply: null,
        engagement: { likeCount: 0, replyCount: 0, repostCount: 2, quoteCount: 0 },
      },
    ], [engagementCoverage, fixtureCoverage('app.bsky.feed.like', 15, true), postCoverage]);

    const original = structuredClone(input);
    const result = analyze(input);

    expect(result).toEqual({
      fetchedAt,
      activity: {
        status: 'complete', postCount: 4, originals: 2, replies: 1, unknownReplyStatus: 1, undatedPosts: 1,
        byUtcDay: [{ date: '2026-01-03', postCount: 2 }, { date: '2026-01-04', postCount: 1 }],
      },
      engagement: {
        likeCount: { status: 'partial', total: 9, average: 3, measuredPosts: 3 },
        replyCount: { status: 'partial', total: 3, average: 1, measuredPosts: 3 },
        repostCount: { status: 'partial', total: 3, average: 1, measuredPosts: 3 },
        quoteCount: { status: 'partial', total: 2, average: 1, measuredPosts: 2 },
      },
      coverage: { posts: [postCoverage], engagement: [engagementCoverage] },
    });
    expect(input).toEqual(original);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('keeps an unreported quote count unknown when the other metrics are complete', () => {
    const result = analyze(snapshot([{
      createdAt: '2026-01-03T09:15:00Z', isReply: false,
      engagement: { likeCount: 1, replyCount: 0, repostCount: 1, quoteCount: null },
    }], [fixtureCoverage(postCollection, 1, true), fixtureCoverage('engagement', 1, true)]));

    expect(result.engagement).toEqual({
      likeCount: { status: 'complete', total: 1, average: 1, measuredPosts: 1 },
      replyCount: { status: 'complete', total: 0, average: 0, measuredPosts: 1 },
      repostCount: { status: 'complete', total: 1, average: 1, measuredPosts: 1 },
      quoteCount: unknownMetric,
    });
  });

  it('keeps unusable publication times out of the UTC timeline without dropping their posts', () => {
    const result = analyze(snapshot([
      { createdAt: '2026-01-03T09:15:00', isReply: false, engagement: null },
      { createdAt: 'invalid', isReply: true, engagement: null },
    ], [fixtureCoverage(postCollection, 2, true)]));

    expect(result.activity).toMatchObject({
      status: 'complete', postCount: 2, originals: 1, replies: 1, undatedPosts: 2, byUtcDay: [],
    });
  });

  it('reports confirmed empty totals with no average or measured posts', () => {
    const result = analyze(snapshot([], [fixtureCoverage(postCollection, 0, true), fixtureCoverage('engagement', 0, true)]));
    const emptyMetric = { status: 'complete', total: 0, average: null, measuredPosts: 0 };

    expect(result.activity).toEqual({
      status: 'complete', postCount: 0, originals: 0, replies: 0, unknownReplyStatus: 0, undatedPosts: 0, byUtcDay: [],
    });
    expect(result.engagement).toEqual({
      likeCount: emptyMetric, replyCount: emptyMetric, repostCount: emptyMetric, quoteCount: emptyMetric,
    });
  });

  it.each([
    { name: 'no coverage', postCoverage: [] },
    { name: 'incomplete post coverage', postCoverage: [fixtureCoverage(postCollection, 0, false)] },
    { name: 'contradictory post coverage', postCoverage: [fixtureCoverage(postCollection, 2, true)] },
  ])('leaves empty activity unknown with $name despite successful AppView coverage', ({ postCoverage }) => {
    const result = analyze(snapshot([], [...postCoverage, fixtureCoverage('engagement', 2, true)]));

    expect(result.activity).toMatchObject({ status: 'unknown', postCount: null });
    expect(result.engagement).toEqual({
      likeCount: unknownMetric, replyCount: unknownMetric, repostCount: unknownMetric, quoteCount: unknownMetric,
    });
  });

  it.each([
    { name: 'incomplete', postCoverage: fixtureCoverage(postCollection, 1, false) },
    { name: 'contradictory', postCoverage: fixtureCoverage(postCollection, 2, true) },
  ])('labels observed counts partial with $name post coverage', ({ postCoverage }) => {
    const result = analyze(snapshot([{
      createdAt: '2026-01-03T09:15:00Z', isReply: true,
      engagement: { likeCount: 5, replyCount: 0, repostCount: 0, quoteCount: 0 },
    }], [postCoverage, fixtureCoverage('engagement', 1, true)]));

    expect(result.activity).toMatchObject({ status: 'partial', postCount: 1 });
    expect(result.engagement.likeCount).toEqual({ status: 'partial', total: 5, average: 5, measuredPosts: 1 });
    expect(result.engagement.replyCount).toEqual({ status: 'partial', total: 0, average: 0, measuredPosts: 1 });
  });

  it('keeps activity complete if the engagement source fails', () => {
    const result = analyze(snapshot([{
      createdAt: null, isReply: null, engagement: null,
    }], [fixtureCoverage(postCollection, 1, true), fixtureCoverage('engagement', 0, false)]));

    expect(result.activity).toMatchObject({ status: 'complete', postCount: 1, undatedPosts: 1, byUtcDay: [] });
    expect(result.engagement).toEqual({
      likeCount: unknownMetric, replyCount: unknownMetric, repostCount: unknownMetric, quoteCount: unknownMetric,
    });
  });

  it.each([
    { name: 'absent', engagementCoverage: [] },
    { name: 'incomplete', engagementCoverage: [fixtureCoverage('engagement', 0, false)] },
    { name: 'nonzero', engagementCoverage: [fixtureCoverage('engagement', 2, true)] },
  ])('leaves empty engagement unknown with $name engagement coverage', ({ engagementCoverage }) => {
    const result = analyze(snapshot([], [fixtureCoverage(postCollection, 0, true), ...engagementCoverage]));

    expect(result.activity).toMatchObject({ status: 'complete', postCount: 0 });
    expect(result.engagement).toEqual({
      likeCount: unknownMetric, replyCount: unknownMetric, repostCount: unknownMetric, quoteCount: unknownMetric,
    });
  });
});
