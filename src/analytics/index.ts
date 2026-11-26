import type { AnalyticsInput, AnalyticsResult, CoverageStatus, EngagementMetric } from './contract';

const postCollection = 'app.bsky.feed.post';
const zonedTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
const millisecondsPerDay = 86_400_000;

function parsePublicationTime(value: string | null): number {
  if (value === null || !zonedTimestamp.test(value)) return NaN;

  // Date.parse can roll an impossible local calendar date into the following month.
  const calendarDate = value.slice(0, 10);
  const midnight = new Date(`${calendarDate}T00:00:00Z`);
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== calendarDate) {
    return NaN;
  }
  return Date.parse(value);
}

function confirmsCount(entries: AnalyticsInput['coverage'], count: number): boolean {
  return entries.length > 0 && entries.every(entry => entry.complete && entry.fetched === count);
}

function coverageStatus(complete: boolean, observed: number): CoverageStatus {
  if (complete) return 'complete';
  return observed > 0 ? 'partial' : 'unknown';
}

function summarizeMetric(
  posts: AnalyticsInput['posts'],
  metric: keyof AnalyticsResult['engagement'],
  sourcesComplete: boolean,
): EngagementMetric {
  let measuredPosts = 0;
  let total = 0;
  for (const post of posts) {
    const count = post.engagement?.[metric] ?? null;
    if (count === null) continue;
    measuredPosts++;
    total += count;
  }

  const status = coverageStatus(sourcesComplete && measuredPosts === posts.length, measuredPosts);
  return {
    status,
    total: status === 'unknown' ? null : total,
    average: measuredPosts > 0 ? total / measuredPosts : null,
    measuredPosts,
  };
}

/** Derive activity and snapshot engagement from one account's normalized posts. */
export function analyze(input: AnalyticsInput): AnalyticsResult {
  const { fetchedAt, posts } = input;
  const coverage: AnalyticsResult['coverage'] = { posts: [], engagement: [] };
  for (const entry of input.coverage) {
    if (entry.collection === postCollection) coverage.posts.push({ ...entry });
    if (entry.collection === 'engagement') coverage.engagement.push({ ...entry });
  }

  let originals = 0;
  let replies = 0;
  let undatedPosts = 0;
  const countsByDay = new Map<number, number>();
  for (const post of posts) {
    if (post.isReply === true) replies++;
    if (post.isReply === false) originals++;

    const timestamp = parsePublicationTime(post.createdAt);
    if (!Number.isFinite(timestamp)) {
      undatedPosts++;
      continue;
    }
    const day = Math.floor(timestamp / millisecondsPerDay);
    countsByDay.set(day, (countsByDay.get(day) ?? 0) + 1);
  }

  const byUtcDay = [...countsByDay]
    .sort(([left], [right]) => left - right)
    .map(([day, postCount]) => ({
      date: new Date(day * millisecondsPerDay).toISOString().split('T', 1)[0]!,
      postCount,
    }));
  const postsComplete = confirmsCount(coverage.posts, posts.length);
  const status = coverageStatus(postsComplete, posts.length);
  const engagementComplete = postsComplete && confirmsCount(coverage.engagement, posts.length);

  return {
    fetchedAt,
    activity: {
      status,
      postCount: status === 'unknown' ? null : posts.length,
      originals,
      replies,
      unknownReplyStatus: posts.length - originals - replies,
      undatedPosts,
      byUtcDay,
    },
    engagement: {
      likeCount: summarizeMetric(posts, 'likeCount', engagementComplete),
      replyCount: summarizeMetric(posts, 'replyCount', engagementComplete),
      repostCount: summarizeMetric(posts, 'repostCount', engagementComplete),
      quoteCount: summarizeMetric(posts, 'quoteCount', engagementComplete),
    },
    coverage,
  };
}
