import { describe, expect, it } from 'vitest';
import type { ChartWidget, NoteWidget, Section } from '../contract';
import { SAMPLE_SCENARIOS } from '../samples';
import type { TemporaryAnalyticsResult } from '../temporary/analytics-pr20';
import { axisLabelIndices, timelineSection } from './timeline';

const sample = (id: string): TemporaryAnalyticsResult => {
  const a = SAMPLE_SCENARIOS.find((s) => s.id === id)?.inputs.analytics;
  if (!a) throw new Error(id);
  return a;
};

const chartOf = (s: Section) => s.widgets.find((w) => w.kind === 'chart') as ChartWidget;
const notes = (s: Section) => s.widgets.filter((w) => w.kind === 'note').map((w) => (w as NoteWidget).text);

function withDays(byUtcDay: { date: string; postCount: number }[], extra: Partial<TemporaryAnalyticsResult['activity']> = {}) {
  const base = sample('complete');
  const dated = byUtcDay.reduce((n, d) => n + d.postCount, 0);
  return {
    ...base,
    fetchedAt: '2026-11-10T20:30:00.000Z',
    activity: { ...base.activity, postCount: dated, originals: dated, replies: 0, undatedPosts: 0, byUtcDay, ...extra },
  };
}

describe('timelineSection', () => {
  it('fills gaps with zero days from the first post to the fetchedAt day (UTC)', () => {
    const chart = chartOf(timelineSection(withDays([{ date: '2026-11-06', postCount: 2 }, { date: '2026-11-08', postCount: 1 }])));
    expect(chart.points.map((p) => p.key)).toEqual(['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
    expect(chart.points.map((p) => p.values)).toEqual([[2], [0], [1], [0], [0]]);
  });

  it('crosses month and year boundaries in UTC', () => {
    const a = withDays([{ date: '2025-12-31', postCount: 1 }]);
    const chart = chartOf(timelineSection({ ...a, fetchedAt: '2026-01-02T00:30:00.000Z' }));
    expect(chart.points.map((p) => p.key)).toEqual(['2025-12-31', '2026-01-01', '2026-01-02']);
  });

  it('leaves out posts dated after the time of reading, and says so', () => {
    const s = timelineSection(withDays([{ date: '2026-11-09', postCount: 1 }, { date: '9999-12-31', postCount: 2 }]));
    expect(chartOf(s).points.map((p) => p.key)).toEqual(['2026-11-09', '2026-11-10']);
    expect(notes(s).join(' ')).toContain('2 posts are dated after the time of reading and are not shown.');
  });

  it('partial read: days with no posts read are unknown (null), never 0; read days keep their counts', () => {
    const a = withDays([{ date: '2026-11-06', postCount: 2 }, { date: '2026-11-08', postCount: 1 }], { status: 'partial' });
    const s = timelineSection(a);
    expect(chartOf(s).points.map((p) => p.values)).toEqual([[2], [null], [1], [null], [null]]);
    expect(notes(s).join(' ')).toMatch(/shown as unknown, not zero/);
    expect(notes(s).join(' ')).not.toMatch(/gap is not proof/);
  });

  it('complete read: gap days are observed zeros', () => {
    const chart = chartOf(timelineSection(withDays([{ date: '2026-11-08', postCount: 1 }])));
    expect(chart.points.every((p) => p.values.every((v) => v !== null))).toBe(true);
  });

  it('caps the range to the last 365 days and labels what was left out', () => {
    const s = timelineSection(withDays([{ date: '2019-01-01', postCount: 1 }, { date: '2026-11-09', postCount: 4 }]));
    const chart = chartOf(s);
    expect(chart.points).toHaveLength(365);
    expect(chart.points[0]!.key).toBe('2025-11-11');
    expect(chart.points.at(-1)!.key).toBe('2026-11-10');
    expect(notes(s).join(' ')).toContain(
      'Showing the last 365 days (2025-11-11 to 2026-11-10, UTC). 1 earlier post on 1 day is not shown.',
    );
  });

  it('the cap is configurable and counts every left-out post and day', () => {
    const s = timelineSection(
      withDays([{ date: '2026-11-01', postCount: 2 }, { date: '2026-11-02', postCount: 3 }, { date: '2026-11-09', postCount: 1 }]),
      7,
    );
    expect(chartOf(s).points.map((p) => p.key)[0]).toBe('2026-11-04');
    expect(notes(s).join(' ')).toContain('5 earlier posts on 2 days are not shown.');
  });

  it('a short range is not labelled as capped', () => {
    expect(notes(timelineSection(sample('complete'))).join(' ')).not.toMatch(/Showing the last/);
  });

  it('bar values sum to the dated post count, so the data table matches the bars', () => {
    for (const id of ['complete', 'partial']) {
      const a = sample(id);
      const chart = chartOf(timelineSection(a));
      const sum = chart.points.reduce((n, p) => n + (p.values[0] ?? 0), 0);
      expect(sum).toBe(a.activity.postCount! - a.activity.undatedPosts);
      expect(chart.series).toHaveLength(1);
      for (const p of chart.points) expect(p.values).toHaveLength(chart.series.length);
    }
  });

  it('says UTC in the title and the table header', () => {
    const chart = chartOf(timelineSection(sample('complete')));
    expect(chart.title).toContain('(UTC)');
    expect(chart.labelHeader).toContain('UTC');
    expect(chart.axis).toBe('utc-day');
  });

  it('always notes that a gap is not proof of inactivity when there is data', () => {
    expect(notes(timelineSection(sample('complete'))).join(' ')).toMatch(/gap is not proof of inactivity/);
  });

  it('notes undated posts only when there are some', () => {
    expect(notes(timelineSection(sample('partial'))).join(' ')).toMatch(/3 posts have no usable date/);
    expect(notes(timelineSection(sample('complete'))).join(' ')).not.toMatch(/no usable date/);
  });

  it('partial read: chart status partial with the reason in a note', () => {
    const s = timelineSection(sample('partial'));
    expect(chartOf(s).status).toBe('partial');
    expect(chartOf(s).statusText).toBe('Partial');
    expect(notes(s).join(' ')).toMatch(/record cap/);
  });

  it('empty account: no points, an "observed zero" empty text', () => {
    const chart = chartOf(timelineSection(sample('empty')));
    expect(chart.points).toEqual([]);
    expect(chart.status).toBe('complete');
    expect(chart.emptyText).toMatch(/no posts/i);
  });

  it('unknown activity: no points and an Unknown empty text, never a zero chart', () => {
    const chart = chartOf(timelineSection(withDays([], { status: 'unknown', postCount: null })));
    expect(chart.points).toEqual([]);
    expect(chart.status).toBe('unknown');
    expect(chart.emptyText).toMatch(/unknown/i);
  });

  it('no analysis: unknown chart and no throw', () => {
    const chart = chartOf(timelineSection(null));
    expect(chart.status).toBe('unknown');
    expect(chart.points).toEqual([]);
  });

  it('ignores malformed dates instead of drawing them', () => {
    const chart = chartOf(timelineSection(withDays([{ date: 'not-a-date', postCount: 5 }, { date: '2026-11-09', postCount: 1 }])));
    expect(chart.points.map((p) => p.key)).toEqual(['2026-11-09', '2026-11-10']);
  });

  it('output is plain JSON', () => {
    for (const s of SAMPLE_SCENARIOS) {
      const section = timelineSection(s.inputs.analytics);
      expect(JSON.parse(JSON.stringify(section))).toEqual(section);
    }
  });
});

describe('axisLabelIndices', () => {
  it('labels every point up to 12', () => {
    expect(axisLabelIndices(0)).toEqual([]);
    expect(axisLabelIndices(1)).toEqual([0]);
    expect(axisLabelIndices(12)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('labels first, middle and last above 12', () => {
    expect(axisLabelIndices(13)).toEqual([0, 6, 12]);
    expect(axisLabelIndices(30)).toEqual([0, 14, 29]);
  });
});
