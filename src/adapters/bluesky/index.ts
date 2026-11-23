import type {
  Adapter,
  AdapterContext,
  AdapterIssue,
  AdapterItem,
  AdapterOutput,
  AdapterRequest,
  CoverageEntry,
  EngagementItem,
  ProfileStatsItem,
} from '../contract';
import { getJson } from '../http';
import { asCount, asString, chunk, isRecord, issue, mapPool } from '../util';

const SRC = 'bluesky' as const;
const POST_COLLECTION = 'app.bsky.feed.post';
const GET_POSTS_MAX = 25; // app.bsky.feed.getPosts: max 25 URIs per call
const FEED_PAGE = 100; // app.bsky.feed.getAuthorFeed: max limit 100
const DEFAULT_MAX_POSTS = 1000;

/** Parse one AppView postView into an engagement item. Null if unusable. */
export function toEngagement(post: unknown, fetchedAt: string): EngagementItem | null {
  if (!isRecord(post)) return null;
  const uri = asString(post.uri);
  const cid = asString(post.cid);
  if (!uri || !cid) return null;
  return {
    kind: 'engagement',
    source: SRC,
    fetchedAt,
    uri,
    cid,
    // The AppView omits zero counts on some views; absent means 0 for these three.
    likeCount: asCount(post.likeCount) ?? 0,
    repostCount: asCount(post.repostCount) ?? 0,
    replyCount: asCount(post.replyCount) ?? 0,
    quoteCount: asCount(post.quoteCount),
    indexedAt: asString(post.indexedAt),
  };
}

async function readProfile(ctx: AdapterContext, actor: string) {
  const r = await getJson<unknown>(
    ctx,
    `${ctx.endpoints.appView}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`,
    { source: SRC, label: 'profile counts' },
  );
  if (!r.ok) return { item: null, issue: { ...r.issue, severity: 'warning' as const } };
  const p = r.value;
  const did = isRecord(p) ? asString(p.did) : null;
  const handle = isRecord(p) ? asString(p.handle) : null;
  if (!isRecord(p) || !did || !handle) {
    return { item: null, issue: issue(SRC, 'bad-response', 'warning', 'Profile response was incomplete.') };
  }
  const item: ProfileStatsItem = {
    kind: 'profile-stats',
    source: SRC,
    fetchedAt: ctx.now().toISOString(),
    did,
    handle,
    displayName: asString(p.displayName),
    followersCount: asCount(p.followersCount),
    followsCount: asCount(p.followsCount),
    postsCount: asCount(p.postsCount),
    createdAt: asString(p.createdAt),
  };
  return { item, issue: null };
}

/** Counts for known post URIs: batched getPosts. */
async function readCountsForUris(ctx: AdapterContext, uris: string[]) {
  const issues: AdapterIssue[] = [];
  const found = new Map<string, EngagementItem>();
  const wanted = new Set(uris);
  let failed = 0;
  const batches = chunk(uris, GET_POSTS_MAX);
  const results = await mapPool(batches, 3, async (batch) => {
    const qs = batch.map((u) => `uris=${encodeURIComponent(u)}`).join('&');
    return getJson<unknown>(ctx, `${ctx.endpoints.appView}/xrpc/app.bsky.feed.getPosts?${qs}`, {
      source: SRC,
      label: 'post counts',
      collection: POST_COLLECTION,
    });
  });
  const fetchedAt = ctx.now().toISOString();
  results.forEach((r, i) => {
    if (!r.ok) {
      failed += batches[i]!.length;
      issues.push(r.issue);
      return;
    }
    const posts = isRecord(r.value) && Array.isArray(r.value.posts) ? r.value.posts : null;
    if (!posts) {
      failed += batches[i]!.length;
      issues.push(issue(SRC, 'bad-response', 'error', 'post counts: response had no post list.', { collection: POST_COLLECTION }));
      return;
    }
    for (const p of posts) {
      const e = toEngagement(p, fetchedAt);
      if (e && wanted.has(e.uri)) found.set(e.uri, e);
    }
  });
  return { found: [...found.values()], issues, failed };
}

/** No upstream records: read the account's own posts from its author feed instead. */
async function readCountsFromFeed(ctx: AdapterContext, did: string, cap: number) {
  const issues: AdapterIssue[] = [];
  const items: EngagementItem[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  let complete = false;
  let reason: CoverageEntry['reason'];
  const fetchedAt = ctx.now().toISOString();

  for (let page = 0; page < 1000; page++) {
    const limit = Math.min(FEED_PAGE, cap - items.length);
    if (limit <= 0) {
      reason = 'record-cap';
      break;
    }
    const qs = new URLSearchParams({ actor: did, limit: String(limit), filter: 'posts_with_replies' });
    if (cursor) qs.set('cursor', cursor);
    const r = await getJson<unknown>(ctx, `${ctx.endpoints.appView}/xrpc/app.bsky.feed.getAuthorFeed?${qs}`, {
      source: SRC,
      label: 'author feed',
      collection: POST_COLLECTION,
    });
    if (!r.ok) {
      issues.push(r.issue);
      reason = r.issue.code === 'aborted' ? 'aborted' : 'error';
      break;
    }
    const feed = isRecord(r.value) && Array.isArray(r.value.feed) ? r.value.feed : null;
    if (!feed) {
      issues.push(issue(SRC, 'bad-response', 'error', 'author feed: response had no feed list.', { collection: POST_COLLECTION }));
      reason = 'error';
      break;
    }
    for (const entry of feed) {
      if (!isRecord(entry) || entry.reason) continue; // reason = repost/pin of someone else's post
      const post = entry.post;
      const author = isRecord(post) && isRecord(post.author) ? asString(post.author.did) : null;
      if (author !== did) continue;
      const e = toEngagement(post, fetchedAt);
      if (e && !seen.has(e.uri)) {
        seen.add(e.uri);
        items.push(e);
      }
    }
    const next = isRecord(r.value) ? asString(r.value.cursor) : null;
    if (!next || feed.length === 0) {
      complete = true;
      break;
    }
    if (next === cursor) {
      reason = 'error';
      issues.push(issue(SRC, 'bad-response', 'warning', 'author feed: server repeated its page cursor; stopped early.', { collection: POST_COLLECTION }));
      break;
    }
    cursor = next;
  }
  if (!complete && !reason) reason = 'record-cap';
  return { items, issues, complete, reason };
}

/**
 * Bluesky adapter: public counters from the Bluesky AppView. No sign-in and
 * no session credentials are ever sent here. Works with or without upstream
 * atproto records: with them it looks up exactly those posts; without them it
 * reads the account's own author feed.
 */
export function createBlueskyAdapter(): Adapter {
  return {
    id: 'bluesky',
    async run(ctx, req: AdapterRequest, upstream: readonly AdapterItem[]): Promise<AdapterOutput> {
      const out: AdapterOutput = { items: [], issues: [], coverage: [] };
      const upstreamIdentity = upstream.find((i) => i.kind === 'identity');
      const did = upstreamIdentity?.did ?? req.subject.did ?? null;
      const actor = did ?? req.subject.handle ?? null;
      if (!actor) {
        out.issues.push(issue(SRC, 'invalid-request', 'error', 'Need a DID or a handle to read public counts.'));
        return out;
      }

      const profile = await readProfile(ctx, actor);
      if (profile.item) out.items.push(profile.item);
      if (profile.issue) out.issues.push(profile.issue);

      if (req.options?.includeEngagement === false) return out;
      const resolvedDid = did ?? profile.item?.did ?? null;
      if (!resolvedDid) return out;

      const cap = Math.max(1, Math.floor(req.options?.maxRecordsPerCollection ?? DEFAULT_MAX_POSTS));
      const upstreamHasRecords = upstream.some((i) => i.kind === 'record');

      if (upstreamHasRecords) {
        const uris = [...new Set(upstream.flatMap((i) => (i.kind === 'record' && i.collection === POST_COLLECTION ? [i.uri] : [])))];
        if (uris.length === 0) {
          out.coverage.push({ source: SRC, collection: 'engagement', fetched: 0, complete: true });
          return out;
        }
        const r = await readCountsForUris(ctx, uris);
        out.items.push(...r.found);
        out.issues.push(...r.issues);
        const missing = uris.length - r.found.length - r.failed;
        if (missing > 0) {
          out.issues.push(
            issue(SRC, 'not-indexed', 'info', `${missing} post(s) have no public counts (deleted, or not indexed by the AppView).`, { collection: POST_COLLECTION }),
          );
        }
        const complete = r.found.length === uris.length;
        out.coverage.push({
          source: SRC,
          collection: 'engagement',
          fetched: r.found.length,
          complete,
          ...(complete ? {} : { reason: r.failed > 0 ? ('error' as const) : ('not-indexed' as const) }),
        });
      } else {
        const r = await readCountsFromFeed(ctx, resolvedDid, cap);
        out.items.push(...r.items);
        out.issues.push(...r.issues);
        out.coverage.push({
          source: SRC,
          collection: 'engagement',
          fetched: r.items.length,
          complete: r.complete,
          ...(r.complete ? {} : { reason: r.reason }),
        });
      }
      return out;
    },
  };
}
