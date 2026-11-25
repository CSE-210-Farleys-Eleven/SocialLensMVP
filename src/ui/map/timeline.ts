import type { ChartWidget, MetricStatus, Section, Widget } from '../contract';
import { formatCount, statusTextFor } from '../format';
import { lookupMetric } from '../glossary';
import type { TemporaryAnalyticsResult } from '../temporary/analytics-pr20';
import { coverageReason } from './metric';

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LABELLED = 12;

const GAP_NOTE = 'Only dated posts that were read are shown; a gap is not proof of inactivity.';
const PARTIAL_GAP_NOTE =
  'The read was incomplete, so days with no posts read are shown as unknown, not zero. Counts on other days may be incomplete too.';

/** Milliseconds at 00:00 UTC for a valid YYYY-MM-DD, else null. */
function dayMs(date: string): number | null {
  if (!ISO_DATE.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().startsWith(date) ? ms : null;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Which points get an axis label: all up to 12, otherwise first, middle and last. */
export function axisLabelIndices(count: number): number[] {
  if (count <= MAX_LABELLED) return Array.from({ length: count }, (_, i) => i);
  return [0, Math.floor((count - 1) / 2), count - 1];
}

/** Days shown at most; older posts are counted in a note instead of drawn. */
export const TIMELINE_MAX_DAYS = 365;

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${formatCount(n)} ${many}`);

/**
 * Posts per UTC day (PR #20 `activity.byUtcDay`), one point per day so bars are evenly spaced in
 * time. The range ends at the fetchedAt day and spans at most `maxDays`, starting no earlier than
 * the first post day. Days without posts are 0 after a complete read and unknown (null) after a
 * partial one. Posts outside the range are counted in a note, never drawn.
 */
export function timelineSection(analytics: TemporaryAnalyticsResult | null, maxDays = TIMELINE_MAX_DAYS): Section {
  const a = analytics?.activity;
  const status: MetricStatus = !a || a.status === 'unknown' || a.postCount === null ? 'unknown' : a.status;

  const counts = new Map<number, number>();
  if (a && status !== 'unknown') {
    for (const d of a.byUtcDay) {
      const ms = dayMs(d.date);
      if (ms !== null && Number.isFinite(d.postCount) && d.postCount > 0) counts.set(ms, (counts.get(ms) ?? 0) + d.postCount);
    }
  }

  const points: ChartWidget['points'] = [];
  const left = { earlierPosts: 0, earlierDays: 0, laterPosts: 0 };
  let capped: { start: number; end: number } | null = null;
  if (counts.size > 0) {
    let firstPost = Infinity;
    let lastPost = -Infinity;
    for (const ms of counts.keys()) {
      firstPost = Math.min(firstPost, ms);
      lastPost = Math.max(lastPost, ms);
    }
    const fetchedDay = analytics ? dayMs(analytics.fetchedAt.slice(0, 10)) : null;
    const end = fetchedDay ?? lastPost;
    const earliestAllowed = end - (Math.max(1, Math.floor(maxDays)) - 1) * DAY_MS;
    const start = Math.max(firstPost, earliestAllowed);
    if (firstPost < earliestAllowed) capped = { start, end };
    for (const [ms, n] of counts) {
      if (ms > end) left.laterPosts += n;
      else if (ms < start) {
        left.earlierPosts += n;
        left.earlierDays += 1;
      }
    }
    const gap = status === 'partial' ? null : 0;
    for (let ms = start; ms <= end; ms += DAY_MS) {
      const key = isoDay(ms);
      points.push({ key, label: key, values: [counts.get(ms) ?? gap] });
    }
  }

  const emptyText =
    status === 'unknown'
      ? 'Unknown: no posts were read, so there is no timeline to draw.'
      : status === 'complete' && a?.postCount === 0
        ? 'No posts: every post record was read and there are none.'
        : 'No dated posts were read.';

  const chart: ChartWidget = {
    kind: 'chart',
    id: 'activity.dailyTimeline',
    title: lookupMetric('activity.dailyTimeline')?.label ?? 'Posts per day (UTC)',
    axis: 'utc-day',
    labelHeader: 'Date (UTC)',
    series: [{ id: 'posts', label: 'Posts and replies' }],
    points,
    axisLabelIndices: axisLabelIndices(points.length),
    status,
    statusText: statusTextFor(status === 'unknown' ? null : (a?.postCount ?? null), status),
    emptyText,
  };

  const widgets: Widget[] = [chart];
  if (points.length > 0) widgets.push({ kind: 'note', tone: 'info', text: status === 'partial' ? PARTIAL_GAP_NOTE : GAP_NOTE });
  if (status === 'partial' && analytics) {
    widgets.push({ kind: 'note', tone: 'warning', text: coverageReason(analytics.coverage.posts, 'posts') });
  }
  if (capped) {
    const range = `${isoDay(capped.start)} to ${isoDay(capped.end)}, UTC`;
    const what = `${plural(left.earlierPosts, 'earlier post', 'earlier posts')} on ${plural(left.earlierDays, 'day', 'days')}`;
    widgets.push({
      kind: 'note',
      tone: 'info',
      text: `Showing the last ${formatCount(points.length)} days (${range}). ${what} ${left.earlierPosts === 1 ? 'is' : 'are'} not shown.`,
    });
  }
  if (left.laterPosts > 0) {
    widgets.push({
      kind: 'note',
      tone: 'warning',
      text: `${plural(left.laterPosts, 'post is', 'posts are')} dated after the time of reading and ${left.laterPosts === 1 ? 'is' : 'are'} not shown.`,
    });
  }
  const undated = a && status !== 'unknown' ? a.undatedPosts : 0;
  if (undated > 0) {
    const noun = undated === 1 ? '1 post has' : `${undated} posts have`;
    widgets.push({ kind: 'note', tone: 'info', text: `${noun} no usable date; they count in the total but not on this chart.` });
  }

  return { id: 'activity-timeline', title: 'Timeline', description: null, widgets };
}
