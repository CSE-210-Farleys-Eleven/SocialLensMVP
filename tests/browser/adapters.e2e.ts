import { expect, test } from '@playwright/test';

// The adapters bundle exposes a global `Adapters` inside the page (see scripts/build-browser-bundle.mjs).
declare const Adapters: typeof import('../../src/adapters');

const FIXTURE_DID = 'did:plc:fixtureaaaaaaaaaaaaaaaaa';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.addScriptTag({ url: '/adapters.js' });
});

test.describe('adapters in a real browser (offline, fixtures)', () => {
  test('the browser has the platform features the adapters rely on', async ({ page }) => {
    const features = await page.evaluate(() => ({
      any: typeof AbortSignal.any === 'function',
      timeout: typeof AbortSignal.timeout === 'function',
      fetch: typeof fetch === 'function',
      worker: typeof Worker === 'function',
    }));
    expect(features).toEqual({ any: true, timeout: true, fetch: true, worker: true });
  });

  test('fixture pipeline returns a complete, JSON-safe result', async ({ page }) => {
    const { result, roundTrips } = await page.evaluate(async (did) => {
      const result = await Adapters.collect({ subject: { did } }, { pipeline: Adapters.createFixturePipeline() });
      return { result, roundTrips: JSON.stringify(JSON.parse(JSON.stringify(result))) === JSON.stringify(result) };
    }, FIXTURE_DID);
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(199);
    expect(roundTrips).toBe(true);
  });

  test('live code paths over the fake network behave like in Node', async ({ page }) => {
    const kinds = await page.evaluate(async (did) => {
      const fx = Adapters.createFixtureFetch();
      const r = await Adapters.collect({ subject: { did } }, { context: { fetch: fx.fetch } });
      const counts: Record<string, number> = {};
      for (const i of r.items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
      return { counts, complete: r.complete };
    }, FIXTURE_DID);
    expect(kinds).toEqual({ counts: { identity: 1, record: 137, 'profile-stats': 1, engagement: 60 }, complete: true });
  });

  test('runs inside a Web Worker and the result survives postMessage', async ({ page }) => {
    const out = await page.evaluate(async ({ did, script }) => {
      const src = `importScripts(${JSON.stringify(script)});
        Adapters.collect({ subject: { did: ${JSON.stringify(did)} } }, { pipeline: Adapters.createFixturePipeline() })
          .then((r) => postMessage(r));`;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      const worker = new Worker(url);
      return await new Promise<{ items: number; complete: boolean }>((resolve, reject) => {
        worker.onmessage = (e) => resolve({ items: e.data.items.length, complete: e.data.complete });
        worker.onerror = (e) => reject(new Error(e.message));
      });
    }, { did: FIXTURE_DID, script: new URL('/adapters.js', page.url()).href });
    expect(out).toEqual({ items: 199, complete: true });
  });

  test('cancelling with an AbortSignal yields aborted issues, not a hang or a throw', async ({ page }) => {
    const r = await page.evaluate(async (did) => {
      const ac = new AbortController();
      ac.abort();
      const fx = Adapters.createFixtureFetch();
      const res = await Adapters.collect({ subject: { did } }, { context: { fetch: fx.fetch, signal: ac.signal } });
      return { complete: res.complete, codes: [...new Set(res.issues.map((i) => i.code))] };
    }, FIXTURE_DID);
    expect(r).toEqual({ complete: false, codes: ['aborted'] });
  });

  test('a hung server becomes a timeout issue', async ({ page }) => {
    const r = await page.evaluate(async (did) => {
      const hang = ((_u: unknown, init?: RequestInit) =>
        new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch;
      const res = await Adapters.collect({ subject: { did } }, { context: { fetch: hang, timeoutMs: 50, maxRetries: 0 } });
      return { complete: res.complete, codes: [...new Set(res.issues.map((i) => i.code))] };
    }, FIXTURE_DID);
    expect(r.complete).toBe(false);
    expect(r.codes).toContain('timeout');
  });
});

// Real network. Skipped unless LIVE=1 so CI on every PR stays deterministic;
// run by the scheduled "live-check" workflow and by hand: LIVE=1 npm run test:browser
test.describe('adapters against the real network, from a browser origin (CORS)', () => {
  test.skip(!process.env.LIVE, 'set LIVE=1 to run against the real network');

  test('public @bsky.app account: identity, records and counts are readable cross-origin', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const res = await Adapters.collect({ subject: { handle: 'bsky.app' }, options: { maxRecordsPerCollection: 20 } });
      const counts: Record<string, number> = {};
      for (const i of res.items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
      const id = res.items.find((i) => i.kind === 'identity');
      return {
        counts,
        issues: res.issues.map((i) => `${i.source}/${i.code}`),
        handleVerified: id && id.kind === 'identity' ? id.handleVerified : null,
        createdAt: id && id.kind === 'identity' ? id.createdAt : null,
      };
    });
    expect(r.issues.filter((c) => /network|timeout|auth-required/.test(c))).toEqual([]);
    expect(r.counts.identity).toBe(1);
    expect(r.counts.record).toBeGreaterThan(0);
    expect(r.counts.engagement).toBeGreaterThan(0);
    expect(r.handleVerified).toBe(true);
    expect(r.createdAt).toMatch(/^2023-/);
  });
});
