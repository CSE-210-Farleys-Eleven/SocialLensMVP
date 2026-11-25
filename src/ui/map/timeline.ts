import type { ChartWidget, MetricStatus, Section, Widget } from '../contract';
import { statusTextFor } from '../format';
import { lookupMetric } from '../glossary';
import type { TemporaryAnalyticsResult } from '../temporary/analytics-pr20';
import { coverageReason } from './metric';

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LABELLED = 12;

const GAP_NOTE = 'Only dated posts that were read are shown; a gap is not proof of inactivity.';

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

/**
 * Posts per UTC day (PR #20 `activity.byUtcDay`), filled with zero days from the first post day to
 * the later of the fetchedAt day and the last post day, so bars are evenly spaced in time.
 */
export function timelineSection(analytics: TemporaryAnalyticsResult | null): Section {
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
  if (counts.size > 0) {
    const first = Math.min(...counts.keys());
    const lastPost = Math.max(...counts.keys());
    const fetchedDay = analytics ? dayMs(analytics.fetchedAt.slice(0, 10)) : null;
    const last = fetchedDay !== null && fetchedDay > lastPost ? fetchedDay : lastPost;
    for (let ms = first; ms <= last; ms += DAY_MS) {
      const key = isoDay(ms);
      points.push({ key, label: key, values: [counts.get(ms) ?? 0] });
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
  if (points.length > 0) widgets.push({ kind: 'note', tone: 'info', text: GAP_NOTE });
  if (status === 'partial' && analytics) {
    widgets.push({ kind: 'note', tone: 'warning', text: coverageReason(analytics.coverage.posts, 'posts') });
  }
  const undated = a && status !== 'unknown' ? a.undatedPosts : 0;
  if (undated > 0) {
    const noun = undated === 1 ? '1 post has' : `${undated} posts have`;
    widgets.push({ kind: 'note', tone: 'info', text: `${noun} no usable date; they count in the total but not on this chart.` });
  }

  return { id: 'activity-timeline', title: 'Timeline', description: null, widgets };
}
