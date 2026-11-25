import { describe, expect, it } from 'vitest';
import type { AdapterIssue, CoverageEntry, IdentityItem } from '../../adapters/contract';
import type { FactsWidget, NoteWidget, Section, TableWidget } from '../contract';
import { formatUtcDateTime } from '../format';
import { SAMPLE_SCENARIOS } from '../samples';
import { coverageSection, dashboardMode, identitySection } from './identity';

const inputs = (id: string) => {
  const s = SAMPLE_SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s.inputs;
};
const facts = (s: Section) => {
  const w = s.widgets.find((x) => x.kind === 'facts') as FactsWidget;
  return Object.fromEntries(w.items.map((i) => [i.label, i]));
};
const table = (s: Section, id: string) => s.widgets.find((w) => w.kind === 'table' && (w as TableWidget).id === id) as TableWidget;
const notes = (s: Section) => s.widgets.filter((w) => w.kind === 'note').map((w) => (w as NoteWidget).text).join(' ');

const identity = (over: Partial<IdentityItem>): IdentityItem => ({ ...inputs('complete').identity!, ...over });

describe('formatUtcDateTime', () => {
  it('prints minutes in UTC with the zone named', () => {
    expect(formatUtcDateTime('2026-11-10T20:30:59.000Z')).toBe('2026-11-10 20:30 UTC');
    expect(formatUtcDateTime('2026-11-10T22:30:00+02:00')).toBe('2026-11-10 20:30 UTC');
  });
  it('prints Unknown for null or unparseable input', () => {
    expect(formatUtcDateTime(null)).toBe('Unknown');
    expect(formatUtcDateTime('yesterday')).toBe('Unknown');
  });
});

describe('identitySection', () => {
  it('shows handle, DID as code, PDS, creation date and past handles', () => {
    const f = facts(identitySection(inputs('complete').identity));
    expect(f['Handle']!.value.text).toBe('complete.fixture.test');
    expect(f['Handle']!.statusText).toBe('');
    expect(f['DID']!.value).toEqual({ text: 'did:plc:fixturecomplete00000000001', style: 'code', href: null });
    expect(f['Data server (PDS)']!.value.text).toBe('https://pds.fixture.test');
    expect(f['Data server (PDS)']!.value.href).toBeNull();
    expect(f['Account created']!.value.text).toBe('2024-02-01 09:00 UTC');
    expect(f['Past handles']!.value.text).toBe('old-complete.fixture.test (from 2024-02-01 09:00 UTC)');
  });

  it('flags a handle that did not verify, and one that was not checked', () => {
    expect(facts(identitySection(identity({ handleVerified: false })))['Handle']!.statusText).toBe('Handle not confirmed');
    expect(facts(identitySection(identity({ handleVerified: null })))['Handle']!.statusText).toBe('Handle not checked');
  });

  it('no handle, no history, did:web: says so instead of blanks', () => {
    const f = facts(identitySection(identity({ handle: null, handleHistory: null, createdAt: null, didMethod: 'web', pdsUrl: null })));
    expect(f['Handle']!.value.text).toBe('No handle');
    expect(f['Past handles']!.value.text).toBe('Unknown');
    expect(f['Account created']!.value.text).toBe('Unknown');
    expect(f['Data server (PDS)']!.value.text).toBe('Unknown');
  });

  it('a history with only the current handle shows "None"', () => {
    const f = facts(identitySection(identity({ handle: 'a.fixture.test', handleHistory: [{ handle: 'a.fixture.test', firstSeenAt: '2025-01-01T00:00:00.000Z' }] })));
    expect(f['Past handles']!.value.text).toBe('None');
  });

  it('renders a hostile handle as plain text', () => {
    const f = facts(identitySection(identity({ handle: '<img src=x onerror=alert(1)>' })));
    expect(f['Handle']!.value).toEqual({ text: '<img src=x onerror=alert(1)>', style: 'text', href: null });
  });

  it('no identity: a warning and Unknown everywhere, no throw', () => {
    const s = identitySection(null);
    expect(notes(s)).toMatch(/could not be read/);
    for (const item of Object.values(facts(s))) expect(item.value.text).toBe('Unknown');
  });
});

describe('coverageSection', () => {
  const rows = (entries: CoverageEntry[], issues: AdapterIssue[] = []) =>
    table(coverageSection(entries, issues), 'coverage-table').rows.map((r) => r.map((c) => c.text));

  it('complete -> count; capped -> "At least N"; failed with nothing read -> Unknown', () => {
    expect(
      rows([
        { source: 'atproto', collection: 'app.bsky.feed.post', fetched: 61, complete: true },
        { source: 'atproto', collection: 'app.bsky.feed.like', fetched: 1000, complete: false, reason: 'record-cap' },
        { source: 'atproto', collection: 'app.bsky.graph.follow', fetched: 0, complete: false, reason: 'error' },
        { source: 'bluesky', collection: 'engagement', fetched: 3, complete: false, reason: 'error' },
      ]),
    ).toEqual([
      ['Posts', 'app.bsky.feed.post', 'Complete', '61', ''],
      ['Likes', 'app.bsky.feed.like', 'Partial', 'At least 1,000', 'Stopped at the record cap; there may be more.'],
      ['Follows', 'app.bsky.graph.follow', 'Failed', 'Unknown', 'The read failed.'],
      ['Interaction counters', 'engagement', 'Partial', 'At least 3', 'The read failed part-way.'],
    ]);
  });

  it('a complete empty collection is an observed zero', () => {
    expect(rows([{ source: 'atproto', collection: 'app.bsky.graph.block', fetched: 0, complete: true }])[0]).toEqual([
      'Blocks', 'app.bsky.graph.block', 'Complete', '0', 'Observed zero',
    ]);
  });

  it('unknown collections show the NSID as their name', () => {
    expect(rows([{ source: 'atproto', collection: 'com.example.thing', fetched: 2, complete: true }])[0]![0]).toBe('com.example.thing');
  });

  it('NSIDs are code, nothing is a link', () => {
    const t = table(coverageSection(inputs('partial').coverage, inputs('partial').issues), 'coverage-table');
    expect(t.rows.every((r) => r[1]!.style === 'code')).toBe(true);
    expect(t.rows.flat().every((c) => c.href === null)).toBe(true);
  });

  it('lists issues with severity and the user-safe message, errors first', () => {
    const t = table(coverageSection(inputs('partial').coverage, inputs('partial').issues), 'issues-table');
    expect(t.rows.map((r) => r[0]!.text)).toEqual(['Error', 'Warning']);
    expect(t.rows[0]![1]!.text).toBe('Your data server returned an error while listing likes.');
    expect(t.rows[0]![2]!.text).toBe('app.bsky.feed.like');
  });

  it('no issues -> empty text; no coverage -> warning note', () => {
    expect(table(coverageSection(inputs('complete').coverage, []), 'issues-table').rows).toEqual([]);
    expect(notes(coverageSection([], []))).toMatch(/Nothing was read/);
  });

  it('says how many collections were read completely', () => {
    expect(notes(coverageSection(inputs('partial').coverage, []))).toContain('0 of 3 reads finished completely.');
    expect(notes(coverageSection(inputs('complete').coverage, []))).toContain('4 of 4 reads finished completely.');
  });
});

describe('dashboardMode', () => {
  it('is demo for every sample', () => {
    for (const s of SAMPLE_SCENARIOS) expect(dashboardMode(s.inputs)).toBe('demo');
  });

  it('is demo if any single input came from fixtures', () => {
    const live = {
      ...inputs('complete'),
      identity: identity({ source: 'atproto' }),
      profile: null,
      coverage: [{ source: 'atproto' as const, collection: 'app.bsky.feed.post', fetched: 1, complete: true }],
    };
    const analytics = live.analytics!;
    const liveAnalytics = { ...analytics, coverage: { posts: live.coverage, engagement: [] } };
    expect(dashboardMode({ ...live, analytics: liveAnalytics })).toBe('live');
    expect(dashboardMode({ ...live, analytics })).toBe('demo');
  });
});
