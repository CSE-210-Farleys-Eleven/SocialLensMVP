import type { AdapterResult, AtUri, EngagementItem, IsoDateTime } from '../adapters/contract';

export type EngagementCounts = Pick<EngagementItem, 'likeCount' | 'replyCount' | 'repostCount' | 'quoteCount'>;

export interface NormalizedPost {
  uri: AtUri;
  createdAt: IsoDateTime | null;
  isReply: boolean | null;
  engagement: EngagementCounts | null;
}

export interface NormalizeResult {
  fetchedAt: IsoDateTime;
  posts: NormalizedPost[];
  coverage: AdapterResult['coverage'];
}
