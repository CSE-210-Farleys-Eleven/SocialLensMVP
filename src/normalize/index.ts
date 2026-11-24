import type { AdapterResult } from '../adapters/contract';
import type { EngagementCounts, NormalizedPost, NormalizeResult } from './contract';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Require an explicit time zone so the browser's local zone cannot change a posting day.
function readTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i;
  return timestamp.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
}

function readReplyStatus(body: Record<string, unknown> | null): boolean | null {
  if (!body) return null;
  if (!('reply' in body)) return false;
  return isObject(body.reply) ? true : null;
}

export function normalize(input: AdapterResult): NormalizeResult {
  const countsByUri = new Map<string, EngagementCounts>();
  for (const item of input.items) {
    if (item.kind !== 'engagement') continue;
    const { likeCount, replyCount, repostCount, quoteCount } = item;
    countsByUri.set(item.uri, { likeCount, replyCount, repostCount, quoteCount });
  }

  const posts: NormalizedPost[] = [];
  for (const item of input.items) {
    if (item.kind !== 'record' || item.collection !== 'app.bsky.feed.post') continue;
    const body = isObject(item.value) ? item.value : null;
    posts.push({
      uri: item.uri,
      createdAt: readTimestamp(body?.createdAt),
      isReply: readReplyStatus(body),
      engagement: countsByUri.get(item.uri) ?? null,
    });
  }

  return { fetchedAt: input.fetchedAt, posts, coverage: input.coverage };
}
