import type { MetricStatus, Section, TableCell, Widget } from '../contract';
import { formatCount } from '../format';
import { UNAVAILABLE_METRICS } from '../glossary';
import type {
  TemporaryAnalyticsResult,
  TemporaryEngagementKey,
  TemporaryEngagementMetric,
} from '../temporary/analytics-pr20';
import { coverageReason, metricWidget } from './metric';

const KINDS: { key: TemporaryEngagementKey; id: string; noun: string; counter: string }[] = [
  { key: 'likeCount', id: 'likes', noun: 'likes', counter: 'like count' },
  { key: 'repostCount', id: 'reposts', noun: 'reposts', counter: 'repost count' },
  { key: 'replyCount', id: 'replies', noun: 'replies', counter: 'reply count' },
  { key: 'quoteCount', id: 'quotes', noun: 'quotes', counter: 'quote count' },
];

const NO_ANALYSIS = 'Interaction counts could not be calculated: the analysis did not run or failed.';
const NOT_A_RATE = 'These are averages per post, not an engagement rate: there is no view count to divide by.';
const UNKNOWN_REASON = 'No counter could be read for any post.';

const posts = (n: number) => (n === 1 ? '1 post' : `${formatCount(n)} posts`);

function metricWidgets(
  kind: (typeof KINDS)[number],
  m: TemporaryEngagementMetric | null,
  analytics: TemporaryAnalyticsResult | null,
): Widget[] {
  const status: MetricStatus = !m || m.status === 'unknown' || m.total === null ? 'unknown' : m.status;
  const reason = !analytics
    ? NO_ANALYSIS
    : status === 'unknown'
      ? UNKNOWN_REASON
      : status === 'partial'
        ? coverageReason(analytics.coverage.engagement, 'interaction counters')
        : null;
  const measured = m?.measuredPosts ?? 0;
  const known = status === 'unknown' ? null : `${posts(measured)} with a known count`;
  const nothingToCompute = status === 'complete' && measured === 0;
  // "3 of 50 posts read had a known like count": how much of the read the number rests on.
  const postsRead = analytics && analytics.activity.status !== 'unknown' ? analytics.activity.postCount : null;
  const coverage =
    !analytics || nothingToCompute
      ? null
      : postsRead !== null
        ? `${formatCount(measured)} of ${posts(postsRead)} read had a known ${kind.counter}`
        : `${posts(measured)} had a known ${kind.counter}`;

  return [
    metricWidget({
      id: `engagement.${kind.id}.total`,
      value: status === 'unknown' ? null : (m?.total ?? null),
      status,
      format: 'integer',
      countCanOnlyGrow: true,
      reason,
      detail: coverage,
    }),
    metricWidget({
      id: `engagement.${kind.id}.average`,
      value: status === 'unknown' || nothingToCompute ? null : (m?.average ?? null),
      status,
      format: 'decimal1',
      countCanOnlyGrow: false,
      reason,
      detail:
        known && !nothingToCompute && m?.total != null
          ? `${formatCount(m.total)} ${kind.noun} ÷ ${known}`
          : null,
      ...(nothingToCompute ? { nothingToComputeText: 'No posts' } : {}),
    }),
  ];
}

const text = (t: string): TableCell => ({ text: t, style: 'text', href: null });

/**
 * Interactions received (PR #20 `engagement`) plus the list of metrics SocialLens deliberately does
 * not show. Each total and average is computed by analytics over posts with a known count; the
 * core only labels them.
 */
export function engagementSections(analytics: TemporaryAnalyticsResult | null): Section[] {
  const widgets: Widget[] = [];
  if (!analytics) widgets.push({ kind: 'note', tone: 'warning', text: NO_ANALYSIS });
  for (const kind of KINDS) widgets.push(...metricWidgets(kind, analytics?.engagement[kind.key] ?? null, analytics));
  widgets.push({ kind: 'note', tone: 'info', text: NOT_A_RATE });

  const notAvailable: Section = {
    id: 'not-available',
    title: 'Not shown, and why',
    description: 'Numbers other tools show that SocialLens cannot measure honestly from public records.',
    widgets: [
      {
        kind: 'table',
        id: 'not-available-metrics',
        title: 'Metrics not shown',
        columns: [
          { id: 'metric', label: 'Metric' },
          { id: 'reason', label: 'Why it is not shown' },
          { id: 'requires', label: 'What it would take' },
        ],
        rows: UNAVAILABLE_METRICS.map((m) => [text(m.label), text(m.reason), text(m.wouldRequire)]),
        emptyText: 'None.',
        totalRows: UNAVAILABLE_METRICS.length,
      },
    ],
  };

  return [
    {
      id: 'engagement-received',
      title: 'Interactions received',
      description: 'Public counters on your posts and replies, as read at the time of reading.',
      widgets,
    },
    notAvailable,
  ];
}
