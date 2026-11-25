/** TEMPORARY — copied from SocialLensMVP PR #20 (branch analytics/post-summary) src/analytics/contract.ts.
 *  Replace with `import type { AnalyticsResult } from '../../analytics/contract'` once PR #20 merges.
 *  Tracked in transition/ui/README.md#temporary-inputs.
 */
import type { CoverageEntry, IsoDateTime } from '../../adapters/contract';

export type TemporaryCoverageStatus = 'complete' | 'partial' | 'unknown';

export interface TemporaryActivitySummary {
  status: TemporaryCoverageStatus;
  postCount: number | null;
  originals: number;
  replies: number;
  unknownReplyStatus: number;
  undatedPosts: number;
  byUtcDay: { date: string; postCount: number }[];
}

export interface TemporaryEngagementMetric {
  status: TemporaryCoverageStatus;
  total: number | null;
  average: number | null;
  measuredPosts: number;
}

export type TemporaryEngagementKey = 'likeCount' | 'replyCount' | 'repostCount' | 'quoteCount';

export interface TemporaryAnalyticsResult {
  fetchedAt: IsoDateTime;
  activity: TemporaryActivitySummary;
  engagement: Record<TemporaryEngagementKey, TemporaryEngagementMetric>;
  coverage: { posts: CoverageEntry[]; engagement: CoverageEntry[] };
}
