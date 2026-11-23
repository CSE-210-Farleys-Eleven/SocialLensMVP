import { describe, expect, it } from 'vitest';
import { collect, createFixturePipeline, createLivePipeline } from './collect';
import type { Adapter, AdapterItem, AdapterResult } from './contract';
import { FIXTURE_DID, FIXTURE_HANDLE, FIXTURE_SCENARIOS, createFixtureFetch } from './fixtures';

const live = (scenario: Parameters<typeof createFixtureFetch>[0] = 'typical') => {
  const fx = createFixtureFetch(scenario);
  return { fx, ctx: { fetch: fx.fetch, sleep: async () => {} } };
};
const kinds = (r: AdapterResult) => r.items.reduce<Record<string, number>>((m, i) => ((m[i.kind] = (m[i.kind] ?? 0) + 1), m), {});

describe('collect (live pipeline over fake network)', () => {
  it('returns ONE flat collection with identity, records, profile counters and engagement', async () => {
    const { ctx } = live();
    const r = await collect({ subject: { handle: FIXTURE_HANDLE } }, { context: ctx });
    expect(r.schemaVersion).toBe(1);
    expect(r.adapters).toEqual(['atproto', 'bluesky']);
    expect(kinds(r)).toEqual({ identity: 1, record: 137, 'profile-stats': 1, engagement: 60 });
    expect(r.subject).toEqual({ did: FIXTURE_DID, handle: FIXTURE_HANDLE, pdsUrl: 'https://pds.fixture.test' });
    expect(r.complete).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('is JSON-serialisable with no loss (safe to cross a Worker boundary)', async () => {
    const { ctx } = live();
    const r = await collect({ subject: { did: FIXTURE_DID } }, { context: ctx });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it('every item carries provenance', async () => {
    const { ctx } = live();
    const r = await collect({ subject: { did: FIXTURE_DID } }, { context: ctx });
    for (const i of r.items) {
      expect(['atproto', 'bluesky']).toContain(i.source);
      expect(Date.parse(i.fetchedAt)).not.toBeNaN();
    }
  });

  it('respects the registry collection list', async () => {
    const { ctx, fx } = live();
    const r = await collect({ subject: { did: FIXTURE_DID }, collections: ['app.bsky.graph.block'] }, { context: ctx });
    expect(r.items.filter((i) => i.kind === 'record').length).toBe(2);
    expect(r.items.filter((i) => i.kind === 'engagement')).toHaveLength(0); // no posts requested
    expect(fx.calls.some((c) => c.includes('getPosts'))).toBe(false);
    expect(r.complete).toBe(true);
  });

  it('empty account: complete, with honest zeros (not errors)', async () => {
    const { ctx } = live('empty');
    const r = await collect({ subject: { did: FIXTURE_DID } }, { context: ctx });
    expect(kinds(r)).toMatchObject({ identity: 1, 'profile-stats': 1 });
    expect(r.items.some((i) => i.kind === 'record')).toBe(false);
    expect(r.complete).toBe(true);
  });

  it('AppView down: records and identity still delivered, result marked incomplete', async () => {
    const { ctx } = live('appview-down');
    const r = await collect({ subject: { did: FIXTURE_DID } }, { context: { ...ctx, maxRetries: 0 } });
    expect(kinds(r).record).toBe(137);
    expect(kinds(r).engagement).toBeUndefined();
    expect(r.complete).toBe(false);
    expect(r.issues.some((i) => i.source === 'bluesky' && i.severity === 'error')).toBe(true);
  });

  it('PDS down: identity delivered, no records, incomplete, collect() still resolves', async () => {
    const { ctx } = live('pds-down');
    const r = await collect({ subject: { did: FIXTURE_DID } }, { context: { ...ctx, maxRetries: 0 } });
    expect(kinds(r).identity).toBe(1);
    expect(kinds(r).record).toBeUndefined();
    expect(r.complete).toBe(false);
  });

  it('record cap makes the result honestly incomplete', async () => {
    const { ctx } = live();
    const r = await collect({ subject: { did: FIXTURE_DID }, options: { maxRecordsPerCollection: 5 } }, { context: ctx });
    expect(r.complete).toBe(false);
    expect(r.coverage.some((c) => c.reason === 'record-cap')).toBe(true);
  });

  it('rejects an empty request as a value, not an exception', async () => {
    const r = await collect({ subject: {} }, { context: live().ctx });
    expect(r.complete).toBe(false);
    expect(r.items).toEqual([]);
    expect(r.issues[0]).toMatchObject({ source: 'collector', code: 'invalid-request' });
    // @ts-expect-error deliberately malformed input from an untyped caller
    const r2 = await collect(undefined, { context: live().ctx });
    expect(r2.issues[0]?.code).toBe('invalid-request');
  });

  it('unknown account: reports not-found, no throw', async () => {
    const { ctx } = live();
    const r = await collect({ subject: { did: 'did:plc:zzzzzzzzzzzzzzzzzzzzzzzz' } }, { context: ctx });
    expect(r.complete).toBe(false);
    expect(r.issues.some((i) => i.code === 'not-found')).toBe(true);
  });

  it('cancellation: a pre-aborted signal yields aborted issues, no crash', async () => {
    const ac = new AbortController();
    ac.abort();
    const { ctx } = live();
    const r = await collect({ subject: { did: FIXTURE_DID } }, { context: { ...ctx, signal: ac.signal } });
    expect(r.complete).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues.every((i) => i.code === 'aborted')).toBe(true);
    expect(r.items.filter((i) => i.kind === 'record')).toHaveLength(0);
  });
});

describe('collect (isolation between adapters)', () => {
  const ok: Adapter = {
    id: 'fixtures',
    async run() {
      const item: AdapterItem = { kind: 'profile-stats', source: 'fixtures', fetchedAt: 't', did: 'd', handle: 'h', displayName: null, followersCount: 1, followsCount: 1, postsCount: 1, createdAt: null };
      return { items: [item], issues: [], coverage: [] };
    },
  };
  const boom: Adapter = {
    id: 'bluesky',
    async run() {
      throw new Error('kaboom: secret-token-123');
    },
  };

  it('one adapter crashing in a stage does not lose the others', async () => {
    const r = await collect({ subject: { did: FIXTURE_DID } }, { pipeline: [[ok, boom]] });
    expect(r.items).toHaveLength(1);
    const crash = r.issues.find((i) => i.code === 'adapter-crashed');
    expect(crash).toMatchObject({ source: 'bluesky', severity: 'error' });
    expect(JSON.stringify(r)).not.toContain('secret-token-123'); // error text is not echoed
    expect(r.complete).toBe(false);
  });

  it('later stages receive earlier stages\' items', async () => {
    let seen = 0;
    const spy: Adapter = { id: 'bluesky', async run(_c, _r, up) { seen = up.length; return { items: [], issues: [], coverage: [] }; } };
    await collect({ subject: { did: FIXTURE_DID } }, { pipeline: [[ok], [spy]] });
    expect(seen).toBe(1);
  });
});

describe('fixtures pipeline', () => {
  it('works offline: fetch is never called', async () => {
    const r = await collect(
      { subject: { did: 'ignored' } },
      { pipeline: createFixturePipeline(), context: { fetch: (async () => { throw new Error('network used'); }) as typeof fetch } },
    );
    expect(r.adapters).toEqual(['fixtures']);
    expect(r.items.every((i) => i.source === 'fixtures')).toBe(true);
    expect(r.complete).toBe(true);
  });

  it('produces the same set of records as the live pipeline over the fake network', async () => {
    const f = await collect({ subject: { did: FIXTURE_DID } }, { pipeline: createFixturePipeline() });
    const { ctx } = live();
    const l = await collect({ subject: { did: FIXTURE_DID } }, { pipeline: createLivePipeline(), context: ctx });
    const key = (r: AdapterResult) => r.items.map((i) => (i.kind === 'record' ? `r:${i.uri}:${i.cid}` : i.kind === 'engagement' ? `e:${i.uri}:${i.likeCount}:${i.replyCount}:${i.repostCount}` : i.kind)).sort();
    expect(key(f)).toEqual(key(l));
    expect(f.subject).toEqual(l.subject);
  });

  it.each(FIXTURE_SCENARIOS)('scenario %s yields a well-formed result', async (s) => {
    const r = await collect({ subject: { did: FIXTURE_DID } }, { pipeline: createFixturePipeline(s) });
    expect(r.schemaVersion).toBe(1);
    expect(Array.isArray(r.items) && Array.isArray(r.issues) && Array.isArray(r.coverage)).toBe(true);
    if (s === 'typical' || s === 'empty') expect(r.complete).toBe(true);
    else expect(r.complete).toBe(false);
  });

  it('is deterministic', async () => {
    const ctx = { now: () => new Date('2026-01-01T00:00:00Z') };
    const a = await collect({ subject: { did: FIXTURE_DID } }, { pipeline: createFixturePipeline(), context: ctx });
    const b = await collect({ subject: { did: FIXTURE_DID } }, { pipeline: createFixturePipeline(), context: ctx });
    expect(a).toEqual(b);
  });

  it('is obviously synthetic', async () => {
    const r = await collect({ subject: { did: FIXTURE_DID } }, { pipeline: createFixturePipeline() });
    expect(r.subject.did).toMatch(/^did:plc:fixture/);
    expect(r.subject.handle).toMatch(/\.fixture\.test$/);
  });
});
