import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isKnownWidget, lookupMetric, METRIC_DEFINITIONS, SAMPLE_SCENARIOS, UNAVAILABLE_METRICS } from './index';

const here = dirname(fileURLToPath(import.meta.url));

/** Recursively true when `value` contains only JSON types (no Date, Map, functions, undefined, NaN). */
function isPlainJson(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPlainJson);
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.values(value as Record<string, unknown>).every(isPlainJson);
  }
  return false;
}

describe('temporary inputs', () => {
  const dir = join(here, 'temporary');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));

  it('exist', () => {
    expect(files.sort()).toEqual([
      'accounts-pr21.ts',
      'analytics-pr20.ts',
      'auth-session.ts',
      'extended-activity.ts',
      'privacy-observations.ts',
    ]);
  });

  it.each(files)('%s starts with a TEMPORARY header naming its replacement', (file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    expect(text.startsWith('/** TEMPORARY — ')).toBe(true);
    const header = text.slice(0, text.indexOf('*/'));
    expect(header).toMatch(/Replace with/);
    expect(header).toContain('transition/ui/README.md#temporary-inputs');
  });

  it('are each listed in transition/ui/README.md', () => {
    const readme = readFileSync(join(here, '../../transition/ui/README.md'), 'utf8');
    for (const file of files) expect(readme).toContain(`src/ui/temporary/${file}`);
  });
});

describe('sample scenarios', () => {
  it('cover complete, partial and empty', () => {
    expect(SAMPLE_SCENARIOS.map((s) => s.id)).toEqual(['complete', 'partial', 'empty']);
  });

  it.each(SAMPLE_SCENARIOS.map((s) => [s.id, s] as const))('%s is plain JSON', (_id, scenario) => {
    expect(isPlainJson(scenario.inputs)).toBe(true);
    expect(JSON.parse(JSON.stringify(scenario.inputs))).toEqual(scenario.inputs);
  });

  it.each(SAMPLE_SCENARIOS.map((s) => [s.id, s] as const))('%s uses only fictional fixture identities', (_id, scenario) => {
    const text = JSON.stringify(scenario.inputs);
    for (const did of text.match(/did:[a-z]+:[A-Za-z0-9.]+/g) ?? []) expect(did).toMatch(/^did:plc:fixture/);
    for (const host of text.match(/[a-z0-9-]+(\.[a-z0-9-]+)+\.test\b/g) ?? []) expect(host).toMatch(/\.fixture\.test$/);
    expect(scenario.inputs.coverage.every((c) => c.source === 'fixtures')).toBe(true);
    expect(scenario.inputs.identity?.source).toBe('fixtures');
  });

  it('timelines are ascending UTC dates and sum to the dated post count', () => {
    for (const { inputs } of SAMPLE_SCENARIOS) {
      const a = inputs.analytics;
      if (!a) continue;
      const dates = a.activity.byUtcDay.map((d) => d.date);
      expect([...dates].sort()).toEqual(dates);
      for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const dated = a.activity.byUtcDay.reduce((n, d) => n + d.postCount, 0);
      expect(dated + a.activity.undatedPosts).toBe(a.activity.postCount);
      const { originals, replies, unknownReplyStatus } = a.activity;
      expect(originals + replies + unknownReplyStatus).toBe(a.activity.postCount);
    }
  });
});

describe('glossary', () => {
  it('has unique ids', () => {
    const ids = [...METRIC_DEFINITIONS, ...UNAVAILABLE_METRICS].map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('defines every PR #20 metric the dashboard will show', () => {
    const ids = [
      'activity.posts',
      'activity.originals',
      'activity.replies',
      'activity.unknownReplyStatus',
      'activity.undatedPosts',
      'activity.dailyTimeline',
      ...['likes', 'reposts', 'replies', 'quotes'].flatMap((k) => [`engagement.${k}.total`, `engagement.${k}.average`]),
    ];
    for (const id of ids) expect(lookupMetric(id), id).toBeDefined();
  });

  it('never offers a score, rate or reach as a shown metric', () => {
    for (const d of METRIC_DEFINITIONS) expect(d.label.toLowerCase()).not.toMatch(/score|engagement rate|reach|impressions/);
  });

  it('explains every unavailable metric', () => {
    for (const m of UNAVAILABLE_METRICS) {
      expect(m.reason.length).toBeGreaterThan(10);
      expect(m.wouldRequire.length).toBeGreaterThan(3);
    }
  });
});

describe('isKnownWidget', () => {
  it('accepts every kind this version renders', () => {
    for (const kind of ['metric', 'chart', 'table', 'facts', 'note', 'observation']) {
      expect(isKnownWidget({ kind })).toBe(true);
    }
  });

  it('rejects kinds from a newer core so renderers can fall back', () => {
    expect(isKnownWidget({ kind: 'heatmap' })).toBe(false);
  });
});
