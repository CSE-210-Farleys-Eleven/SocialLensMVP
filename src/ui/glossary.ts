/**
 * Plain-language definition of every number the dashboard shows, and of the metrics it
 * deliberately does not show. UI-owned display text until a shared module exists.
 * Wording adapted from Test_Module_SocialLens@2b2e993 src/shared/glossary.ts to the PR #20 metrics.
 * Adding a statistic: add its entry here first; a test fails for any metric id without one.
 */

export interface MetricDefinition {
  id: string;
  label: string;
  definition: string;
  /** How it is computed, in words. */
  formula: string;
  includes: string;
  excludes: string;
  /** e.g. "UTC calendar days" or "Snapshot at the time of reading". */
  timeBasis: string;
}

export interface UnavailableMetric {
  id: string;
  label: string;
  /** Why SocialLens does not show it. */
  reason: string;
  /** What it would take. */
  wouldRequire: string;
}

const SNAPSHOT = 'Counters as read at the time of reading; they do not date individual interactions.';
const POSTS_READ = 'Posts and replies in app.bsky.feed.post that SocialLens read from your repository';

const engagement = (
  key: 'likes' | 'reposts' | 'replies' | 'quotes',
  noun: string,
): MetricDefinition[] => [
  {
    id: `engagement.${key}.total`,
    label: `${noun} received`,
    definition: `The total public ${noun.toLowerCase()} count of your posts and replies whose counters could be read.`,
    formula: `Sum of each post's ${noun.toLowerCase()} count, over posts with a known count.`,
    includes: 'Posts and replies with a counter reported by the Bluesky public API.',
    excludes: 'Posts whose counters could not be read (they are not counted as zero).',
    timeBasis: SNAPSHOT,
  },
  {
    id: `engagement.${key}.average`,
    label: `${noun} per post`,
    definition: `Average public ${noun.toLowerCase()} count per post, over posts with a known count.`,
    formula: `${noun} received ÷ posts with a known ${noun.toLowerCase()} count.`,
    includes: 'Posts and replies with a known counter.',
    excludes: 'Posts with unknown counters. This is not an engagement rate: there is no view count.',
    timeBasis: SNAPSHOT,
  },
];

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    id: 'activity.posts',
    label: 'Posts published',
    definition: 'How many posts and replies you published that SocialLens could read.',
    formula: 'Count of post records read.',
    includes: POSTS_READ + ', with or without a date.',
    excludes: 'Likes, reposts, follows and other record types. Deleted posts.',
    timeBasis: 'All fetched records.',
  },
  {
    id: 'activity.originals',
    label: 'Original posts',
    definition: 'Posts that are not replies.',
    formula: 'Count of post records without a reply field.',
    includes: POSTS_READ + '.',
    excludes: 'Replies, and posts whose body could not be read.',
    timeBasis: 'All fetched records.',
  },
  {
    id: 'activity.replies',
    label: 'Replies',
    definition: 'Posts written as a reply to another post.',
    formula: 'Count of post records with a reply field.',
    includes: POSTS_READ + '.',
    excludes: 'Original posts, and posts whose body could not be read.',
    timeBasis: 'All fetched records.',
  },
  {
    id: 'activity.unknownReplyStatus',
    label: 'Not classified',
    definition: 'Posts whose body could not be read well enough to tell a reply from an original post.',
    formula: 'Count of post records with an unreadable body or reply field.',
    includes: POSTS_READ + '.',
    excludes: 'Posts that were classified.',
    timeBasis: 'All fetched records.',
  },
  {
    id: 'activity.undatedPosts',
    label: 'Posts without a usable date',
    definition: 'Posts that count toward the total but cannot be placed on the timeline.',
    formula: 'Count of post records with a missing or unreadable publication time.',
    includes: POSTS_READ + '.',
    excludes: 'Dated posts.',
    timeBasis: 'All fetched records.',
  },
  {
    id: 'activity.dailyTimeline',
    label: 'Posts per day (UTC)',
    definition: 'How many posts and replies you published on each UTC calendar day.',
    formula: 'Count of dated post records grouped by UTC date.',
    includes: 'Dated posts and replies that were read.',
    excludes: 'Undated posts. A day without bars is not proof you were inactive.',
    timeBasis: 'UTC calendar days.',
  },
  ...engagement('likes', 'Likes'),
  ...engagement('reposts', 'Reposts'),
  ...engagement('replies', 'Replies'),
  ...engagement('quotes', 'Quotes'),
];

export const UNAVAILABLE_METRICS: readonly UnavailableMetric[] = [
  {
    id: 'impressions',
    label: 'Impressions / views',
    reason: 'Not available from public records: no public view counter exists.',
    wouldRequire: 'Data only the platform has.',
  },
  {
    id: 'reach',
    label: 'Reach',
    reason: 'Not available from public records.',
    wouldRequire: 'Data only the platform has.',
  },
  {
    id: 'engagement-rate',
    label: 'Engagement rate',
    reason:
      'There is no exposure denominator, so any "rate" would be invented. SocialLens shows averages per post instead and says what it divides by.',
    wouldRequire: 'Impressions or reach.',
  },
  {
    id: 'follower-growth',
    label: 'Follower growth',
    reason:
      "Unknown: your repository holds only records you created. Follows of you live in other people's repositories and the profile API returns only the current total.",
    wouldRequire: 'A history service that stores snapshots over time (out of scope: no backend, no history store).',
  },
  {
    id: 'unfollows',
    label: 'Unfollows',
    reason: 'Unknown: a deleted follow record disappears.',
    wouldRequire: 'A history service.',
  },
  {
    id: 'who-blocks-me',
    label: 'Who blocks me',
    reason:
      "Deliberately excluded. It needs a network-wide index of other people's records, and SocialLens is self-only.",
    wouldRequire: "A network-wide index of other people's records. Never called.",
  },
  {
    id: 'best-time-to-post',
    label: 'Best time to post',
    reason: 'Not shown: without exposure data it would only restate when you already post.',
    wouldRequire: 'Exposure data.',
  },
  {
    id: 'cross-app-score',
    label: 'Overall score',
    reason: 'Deliberately excluded: no opaque or weighted score, and no single score across apps.',
    wouldRequire: 'Nothing: this is a product decision.',
  },
];

const BY_ID = new Map(METRIC_DEFINITIONS.map((d) => [d.id, d]));

/** The definition for a metric id, or undefined when the id has no glossary entry. */
export function lookupMetric(id: string): MetricDefinition | undefined {
  return BY_ID.get(id);
}
