import type { CoverageEntry, EngagementItem, IsoDateTime } from '../adapters/contract';

type EngagementCounts = Pick<EngagementItem, 'likeCount' | 'replyCount' | 'repostCount' | 'quoteCount'>;

/** The fields analytics consumes from one normalized Bluesky snapshot. */
export interface AnalyticsInput {
  readonly fetchedAt: IsoDateTime;
  readonly posts: readonly {
    readonly createdAt: IsoDateTime | null;
    readonly isReply: boolean | null;
    readonly engagement: Readonly<EngagementCounts> | null;
  }[];
  readonly coverage: readonly CoverageEntry[];
}

export type CoverageStatus = 'complete' | 'partial' | 'unknown';

export interface ActivitySummary {
  status: CoverageStatus;
  postCount: number | null;
  originals: number;
  replies: number;
  unknownReplyStatus: number;
  undatedPosts: number;
  byUtcDay: { date: string; postCount: number }[];
}

export interface EngagementMetric {
  status: CoverageStatus;
  total: number | null;
  average: number | null;
  measuredPosts: number;
}

export interface AnalyticsResult {
  fetchedAt: IsoDateTime;
  activity: ActivitySummary;
  engagement: Record<keyof EngagementCounts, EngagementMetric>;
  coverage: { posts: CoverageEntry[]; engagement: CoverageEntry[] };
}
