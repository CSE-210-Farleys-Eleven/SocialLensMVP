import { describe, expect, it } from 'vitest';
import type { MetricValue, NoteWidget, Section, TableWidget } from '../contract';
import { lookupMetric, UNAVAILABLE_METRICS } from '../glossary';
import { SAMPLE_SCENARIOS } from '../samples';
import type { TemporaryAnalyticsResult, TemporaryEngagementMetric } from '../temporary/analytics-pr20';
import { engagementSections } from './engagement';

const sample = (id: string): TemporaryAnalyticsResult => {
  const a = SAMPLE_SCENARIOS.find((s) => s.id === id)?.inputs.analytics;
  if (!a) throw new Error(id);
  return a;
};

const KEYS = ['likes', 'reposts', 'replies', 'quotes'] as const;

function metrics(sections: Section[]): Record<string, MetricValue> {
  const out: Record<string, MetricValue> = {};
  for (const s of sections) for (const w of s.widgets) if (w.kind === 'metric') {
    const m = (w as { metric: MetricValue }).metric;
    out[m.id] = m;
  }
  return out;
}
const text = (sections: Section[]) =>
  sections.flatMap((s) => s.widgets.filter((w) => w.kind === 'note').map((w) => (w as NoteWidget).text)).join(' ');

function withLikes(likeCount: TemporaryEngagementMetric, engagementComplete = true): TemporaryAnalyticsResult {
  const base = sample('complete');
  return {
    ...base,
    engagement: { ...base.engagement, likeCount },
    coverage: {
      ...base.coverage,
      engagement: [{ source: 'bluesky', collection: 'engagement', fetched: 1, complete: engagementComplete, ...(engagementComplete ? {} : { reason: 'error' as const }) }],
    },
  };
}

describe('engagementSections', () => {
  it('emits total and average for likes, reposts, replies and quotes, all in the glossary', () => {
    const ids = Object.keys(metrics(engagementSections(sample('complete'))));
    expect(ids).toEqual(KEYS.flatMap((k) => [`engagement.${k}.total`, `engagement.${k}.average`]));
    for (const id of ids) expect(lookupMetric(id), id).toBeDefined();
  });

  it('complete sample: totals as integers, averages to one decimal, with the denominator', () => {
    const a = sample('complete');
    const m = metrics(engagementSections(a));
    expect(m['engagement.likes.total']!.valueText).toBe('312');
    expect(m['engagement.likes.average']!.valueText).toBe((312 / a.engagement.likeCount.measuredPosts).toFixed(1));
    expect(m['engagement.likes.average']!.detail).toBe(`312 likes ÷ ${a.engagement.likeCount.measuredPosts} posts with a known count`);
    expect(m['engagement.likes.total']!.detail).toBe(
      `${a.engagement.likeCount.measuredPosts} of ${a.activity.postCount} posts read had a known like count`,
    );
  });

  it('shows how many of the posts read had a known count, also when some were missing', () => {
    const a = withLikes({ status: 'partial', total: 9, average: 3, measuredPosts: 3 }, false);
    const m = metrics(engagementSections({ ...a, activity: { ...a.activity, postCount: 50 } }));
    expect(m['engagement.likes.total']!.detail).toBe('3 of 50 posts read had a known like count');
  });

  it('an unknown counter still says how many posts were read', () => {
    const a = sample('partial');
    const m = metrics(engagementSections(a));
    expect(m['engagement.quotes.total']!.detail).toBe(`0 of ${a.activity.postCount!.toLocaleString('en-US')} posts read had a known quote count`);
  });

  it('without a known post total it states only the measured posts', () => {
    const a = withLikes({ status: 'partial', total: 2, average: 2, measuredPosts: 1 }, false);
    const m = metrics(engagementSections({ ...a, activity: { ...a.activity, status: 'unknown', postCount: null } }));
    expect(m['engagement.likes.total']!.detail).toBe('1 post had a known like count');
  });

  it('PR #20 example: one measured zero + one missing -> partial, total "At least 0", average 0.0 over 1 post', () => {
    const m = metrics(engagementSections(withLikes({ status: 'partial', total: 0, average: 0, measuredPosts: 1 }, false)));
    const total = m['engagement.likes.total']!;
    const avg = m['engagement.likes.average']!;
    expect(total.valueText).toBe('At least 0');
    expect(total.statusText).toBe('Partial');
    expect(avg.valueText).toBe('0.0');
    expect(avg.isLowerBound).toBe(false);
    expect(avg.detail).toBe('0 likes ÷ 1 post with a known count');
    expect(total.reason).toMatch(/failed part-way/);
  });

  it('unknown metric (partial sample quotes): "Unknown", never 0', () => {
    const m = metrics(engagementSections(sample('partial')));
    expect(m['engagement.quotes.total']!.valueText).toBe('Unknown');
    expect(m['engagement.quotes.average']!.valueText).toBe('Unknown');
    expect(m['engagement.quotes.total']!.reason).toBeTruthy();
  });

  it('partial without a failed read still explains itself', () => {
    const m = metrics(engagementSections(withLikes({ status: 'partial', total: 5, average: 5, measuredPosts: 1 }, true)));
    expect(m['engagement.likes.total']!.reason).toBeTruthy();
  });

  it('confirmed empty account: total is an observed zero, average says "No posts" instead of 0 or Unknown', () => {
    const m = metrics(engagementSections(sample('empty')));
    for (const k of KEYS) {
      expect(m[`engagement.${k}.total`]!.valueText).toBe('0');
      expect(m[`engagement.${k}.total`]!.statusText).toBe('Observed zero');
      const avg = m[`engagement.${k}.average`]!;
      expect(avg.value).toBeNull();
      expect(avg.status).toBe('complete');
      expect(avg.valueText).toBe('No posts');
      expect(avg.statusText).toBe('');
    }
  });

  it('says this is not an engagement rate', () => {
    expect(text(engagementSections(sample('complete')))).toContain(
      'These are averages per post, not an engagement rate: there is no view count to divide by.',
    );
  });

  it('lists every metric SocialLens does not show, with why and what it would take', () => {
    const sections = engagementSections(sample('complete'));
    const table = sections.flatMap((s) => s.widgets).find((w) => w.kind === 'table' && (w as TableWidget).id === 'not-available-metrics') as TableWidget;
    expect(table.columns.map((c) => c.label)).toEqual(['Metric', 'Why it is not shown', 'What it would take']);
    expect(table.rows.map((r) => r[0]!.text)).toEqual(UNAVAILABLE_METRICS.map((m) => m.label));
    expect(table.rows.every((r) => r.every((c) => c.href === null))).toBe(true);
    expect(table.totalRows).toBe(UNAVAILABLE_METRICS.length);
  });

  it('no analysis: every value Unknown plus a warning, and the not-available list still shows', () => {
    const sections = engagementSections(null);
    const m = metrics(sections);
    for (const id of Object.keys(m)) expect(m[id]!.valueText).toBe('Unknown');
    expect(Object.keys(m)).toHaveLength(8);
    expect(text(sections)).toMatch(/could not be calculated/);
    expect(sections.some((s) => s.id === 'not-available')).toBe(true);
  });

  it('output is plain JSON', () => {
    for (const s of SAMPLE_SCENARIOS) {
      const out = engagementSections(s.inputs.analytics);
      expect(JSON.parse(JSON.stringify(out))).toEqual(out);
    }
  });
});
