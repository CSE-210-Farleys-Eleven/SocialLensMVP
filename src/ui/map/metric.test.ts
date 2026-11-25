import { describe, expect, it } from 'vitest';
import { buildMetric, coverageReason } from './metric';

const base = { id: 'activity.posts', format: 'integer', countCanOnlyGrow: true } as const;

describe('buildMetric', () => {
  it('turns a null value claimed as complete into unknown', () => {
    const m = buildMetric({ ...base, value: null, status: 'complete' });
    expect(m.status).toBe('unknown');
    expect(m.valueText).toBe('Unknown');
  });

  it('drops the number of a not-available metric', () => {
    const m = buildMetric({ ...base, value: 3, status: 'not-available' });
    expect(m.value).toBeNull();
    expect(m.valueText).toBe('Not available');
    expect(m.statusText).toBe('Not available on this app');
  });

  it('a partial ratio is not a lower bound', () => {
    const m = buildMetric({ id: 'engagement.likes.average', value: 3.44, status: 'partial', format: 'decimal1', countCanOnlyGrow: false });
    expect(m.isLowerBound).toBe(false);
    expect(m.valueText).toBe('3.4');
  });

  it('a complete value carries no reason', () => {
    expect(buildMetric({ ...base, value: 2, status: 'complete', reason: 'stale' }).reason).toBeNull();
  });

  it('uses the glossary label, an override, or the id as a last resort', () => {
    expect(buildMetric({ ...base, value: 1, status: 'complete' }).label).toBe('Posts published');
    expect(buildMetric({ ...base, value: 1, status: 'complete', label: 'Custom' }).label).toBe('Custom');
    expect(buildMetric({ ...base, id: 'not.in.glossary', value: 1, status: 'complete' }).label).toBe('not.in.glossary');
  });
});

describe('coverageReason', () => {
  const entry = (reason?: 'record-cap' | 'error') => ({
    source: 'atproto' as const,
    collection: 'app.bsky.feed.post',
    fetched: 1,
    complete: false,
    ...(reason ? { reason } : {}),
  });

  it('names one reason', () => {
    expect(coverageReason([entry('record-cap')], 'posts')).toBe('Reading posts stopped at its record cap, so there may be more.');
  });

  it('names several distinct reasons once each', () => {
    const text = coverageReason([entry('record-cap'), entry('error'), entry('error')], 'posts');
    expect(text).toMatch(/record cap/);
    expect(text.match(/failed part-way/g)).toHaveLength(1);
  });

  it('falls back to a generic sentence', () => {
    expect(coverageReason([entry()], 'posts')).toBe('Not every post could be confirmed as read.');
  });
});
