import { describe, expect, it } from 'vitest';
import type { CoverageEntry } from '../../adapters/contract';
import type { MetricValue, Section } from '../contract';
import { lookupMetric } from '../glossary';
import { SAMPLE_SCENARIOS } from '../samples';
import type { TemporaryAnalyticsResult } from '../temporary/analytics-pr20';
import { activitySummarySection } from './activity';

const sample = (id: string) => {
  const s = SAMPLE_SCENARIOS.find((x) => x.id === id);
  if (!s?.inputs.analytics) throw new Error(`missing sample ${id}`);
  return s.inputs.analytics;
};

function metrics(section: Section): Record<string, MetricValue> {
  const out: Record<string, MetricValue> = {};
  for (const w of section.widgets) if (w.kind === 'metric' && 'metric' in w) out[(w as { metric: MetricValue }).metric.id] = (w as { metric: MetricValue }).metric;
  return out;
}

const IDS = ['activity.posts', 'activity.originals', 'activity.replies', 'activity.unknownReplyStatus', 'activity.undatedPosts'];

function result(activity: Partial<TemporaryAnalyticsResult['activity']>, posts: CoverageEntry[]): TemporaryAnalyticsResult {
  const base = sample('complete');
  return { ...base, activity: { ...base.activity, ...activity }, coverage: { ...base.coverage, posts } };
}

describe('activitySummarySection', () => {
  it('emits the five activity metrics in a stable order, each with a glossary entry', () => {
    const section = activitySummarySection(sample('complete'));
    expect(section.id).toBe('activity-summary');
    const ids = section.widgets.filter((w) => w.kind === 'metric').map((w) => (w as { metric: MetricValue }).metric.id);
    expect(ids).toEqual(IDS);
    for (const id of ids) expect(lookupMetric(id), id).toBeDefined();
  });

  it('complete sample: exact counts, no status label, labels from the glossary', () => {
    const m = metrics(activitySummarySection(sample('complete')));
    const posts = m['activity.posts']!;
    expect(posts.status).toBe('complete');
    expect(posts.isLowerBound).toBe(false);
    expect(posts.valueText).toBe(String(sample('complete').activity.postCount));
    expect(posts.statusText).toBe('');
    expect(posts.reason).toBeNull();
    expect(posts.label).toBe('Posts published');
    expect(m['activity.unknownReplyStatus']!.valueText).toBe('0');
    expect(m['activity.unknownReplyStatus']!.statusText).toBe('Observed zero');
  });

  it('partial sample: counts are lower bounds with the cap named as the reason', () => {
    const a = sample('partial');
    const m = metrics(activitySummarySection(a));
    const posts = m['activity.posts']!;
    expect(posts.status).toBe('partial');
    expect(posts.isLowerBound).toBe(true);
    expect(posts.valueText).toBe(`At least ${a.activity.postCount!.toLocaleString('en-US')}`);
    expect(posts.statusText).toBe('Partial');
    expect(posts.reason).toMatch(/cap/i);
    for (const id of IDS) expect(m[id]!.valueText.startsWith('At least ')).toBe(true);
  });

  it('empty sample: confirmed zeros are shown as "0" + "Observed zero", not Unknown', () => {
    const m = metrics(activitySummarySection(sample('empty')));
    for (const id of IDS) {
      expect(m[id]!.valueText).toBe('0');
      expect(m[id]!.statusText).toBe('Observed zero');
    }
  });

  it('unknown activity: every count is "Unknown", never 0', () => {
    const m = metrics(
      activitySummarySection(
        result({ status: 'unknown', postCount: null, originals: 0, replies: 0, unknownReplyStatus: 0, undatedPosts: 0, byUtcDay: [] }, []),
      ),
    );
    for (const id of IDS) {
      expect(m[id]!.value).toBeNull();
      expect(m[id]!.valueText).toBe('Unknown');
      expect(m[id]!.status).toBe('unknown');
      expect(m[id]!.reason).not.toBeNull();
    }
  });

  it('a non-null postCount with unknown status is still shown as Unknown', () => {
    const m = metrics(activitySummarySection(result({ status: 'unknown', postCount: 4 }, [])));
    expect(m['activity.posts']!.valueText).toBe('Unknown');
  });

  it.each([
    ['error', /failed/i],
    ['aborted', /cancel/i],
    ['not-indexed', /index/i],
  ] as const)('partial reason for coverage reason %s', (reason, pattern) => {
    const m = metrics(
      activitySummarySection(
        result({ status: 'partial' }, [{ source: 'atproto', collection: 'app.bsky.feed.post', fetched: 3, complete: false, reason }]),
      ),
    );
    expect(m['activity.posts']!.reason).toMatch(pattern);
  });

  it('partial without a coverage reason still explains itself', () => {
    const m = metrics(activitySummarySection(result({ status: 'partial' }, [])));
    expect(m['activity.posts']!.reason).toBeTruthy();
  });

  it('undated posts say they are not on the timeline', () => {
    const m = metrics(activitySummarySection(sample('partial')));
    expect(m['activity.undatedPosts']!.detail).toMatch(/timeline/i);
  });

  it('no analysis: Unknown everywhere plus a note, and no throw', () => {
    const section = activitySummarySection(null);
    const m = metrics(section);
    for (const id of IDS) expect(m[id]!.valueText).toBe('Unknown');
    expect(section.widgets.some((w) => w.kind === 'note')).toBe(true);
  });

  it('output is plain JSON', () => {
    for (const s of SAMPLE_SCENARIOS) {
      const section = activitySummarySection(s.inputs.analytics);
      expect(JSON.parse(JSON.stringify(section))).toEqual(section);
    }
  });
});
