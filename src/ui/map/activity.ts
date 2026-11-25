import type { MetricStatus, Section, Widget } from '../contract';
import type { TemporaryAnalyticsResult } from '../temporary/analytics-pr20';
import { coverageReason, metricWidget } from './metric';

const NO_ANALYSIS = 'Activity could not be calculated: the analysis did not run or failed.';
const UNKNOWN_REASON =
  'No posts were read, and SocialLens could not confirm that you have none.';

/**
 * The activity summary (PR #20 `activity`): post count and its breakdown.
 * The sub-counts describe observed posts, so when the read was partial they are lower bounds too;
 * when the total is unknown they are unknown, never 0.
 */
export function activitySummarySection(analytics: TemporaryAnalyticsResult | null): Section {
  const widgets: Widget[] = [];
  const a = analytics?.activity;

  let status: MetricStatus;
  let reason: string | null;
  if (!a) {
    status = 'unknown';
    reason = NO_ANALYSIS;
    widgets.push({ kind: 'note', tone: 'warning', text: NO_ANALYSIS });
  } else if (a.status === 'unknown' || a.postCount === null) {
    status = 'unknown';
    reason = UNKNOWN_REASON;
  } else if (a.status === 'partial') {
    status = 'partial';
    reason = coverageReason(analytics.coverage.posts, 'posts');
  } else {
    status = 'complete';
    reason = null;
  }

  const count = (id: string, value: number | null | undefined, detail: string | null = null) =>
    metricWidget({
      id,
      value: status === 'unknown' ? null : (value ?? null),
      status,
      format: 'integer',
      countCanOnlyGrow: true,
      reason,
      detail,
    });

  widgets.push(
    count('activity.posts', a?.postCount, 'Includes replies.'),
    count('activity.originals', a?.originals),
    count('activity.replies', a?.replies),
    count('activity.unknownReplyStatus', a?.unknownReplyStatus),
    count('activity.undatedPosts', a?.undatedPosts, 'Counted in the total, but not shown on the timeline.'),
  );

  return {
    id: 'activity-summary',
    title: 'Activity',
    description: 'Posts and replies SocialLens read from your repository.',
    widgets,
  };
}
